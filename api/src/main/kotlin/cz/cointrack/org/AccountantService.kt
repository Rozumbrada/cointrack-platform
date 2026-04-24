package cz.cointrack.org

import cz.cointrack.db.Invoices
import cz.cointrack.db.OrganizationMembers
import cz.cointrack.db.Profiles
import cz.cointrack.db.Receipts
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

/**
 * Sprint 8 Fáze 4: rozhraní pro účetní (role 'accountant').
 *
 * Účetní vidí AGREGACI účtenek a faktur napříč všemi profily organizace,
 * které ji uvedly mezi své členy. NIC NEVIDÍ z transakcí, plánů, dluhů, atd.
 * Read-only.
 */
class AccountantService {

    @Serializable
    data class AccountantAccessibleOrg(
        val orgId: String,
        val orgName: String,
        val orgIco: String? = null,
        val role: String,
    )

    @Serializable
    data class AccountantOrgsResponse(
        val organizations: List<AccountantAccessibleOrg>,
    )

    @Serializable
    data class AccountantReceiptDto(
        val syncId: String,
        val profileId: String,
        val profileName: String,
        val ownerEmail: String,
        val merchantName: String?,
        val date: String,
        val totalWithVat: String,
        val currency: String,
        val paymentMethod: String?,
    )

    @Serializable
    data class AccountantInvoiceDto(
        val syncId: String,
        val profileId: String,
        val profileName: String,
        val ownerEmail: String,
        val invoiceNumber: String?,
        val isExpense: Boolean,
        val issueDate: String?,
        val dueDate: String?,
        val totalWithVat: String,
        val currency: String,
        val supplierName: String?,
        val customerName: String?,
        val paid: Boolean,
    )

    /** Seznam organizací, kde má volající role 'accountant'. */
    suspend fun listMyOrgs(userId: UUID): AccountantOrgsResponse = db {
        val rows = OrganizationMembers
            .selectAll()
            .where {
                (OrganizationMembers.userId eq userId) and
                    (OrganizationMembers.role eq "accountant")
            }
            .toList()

        val orgs = rows.map { row ->
            val orgId = row[OrganizationMembers.organizationId].value
            val org = cz.cointrack.db.Organizations
                .selectAll()
                .where { cz.cointrack.db.Organizations.id eq orgId }
                .single()
            AccountantAccessibleOrg(
                orgId = orgId.toString(),
                orgName = org[cz.cointrack.db.Organizations.name],
                orgIco = null,
                role = "accountant",
            )
        }
        AccountantOrgsResponse(orgs)
    }

    /** Účtenky všech členů organizace, kde je volající 'accountant'. */
    suspend fun listReceipts(userId: UUID, orgId: UUID): List<AccountantReceiptDto> = db {
        requireAccountantRole(userId, orgId)

        // Všechny profily v rámci org
        val profiles = Profiles.selectAll()
            .where {
                (Profiles.organizationId eq orgId) and (Profiles.deletedAt.isNull())
            }
            .toList()

        val profileMap = profiles.associate {
            it[Profiles.id].value to (it[Profiles.name] to it[Profiles.ownerUserId].value)
        }
        val ownerIds = profiles.map { it[Profiles.ownerUserId].value }.distinct()
        val emails = if (ownerIds.isEmpty()) emptyMap() else
            Users.selectAll().where { Users.id inList ownerIds }
                .associate { it[Users.id].value to it[Users.email] }

        val profileIds = profileMap.keys
        if (profileIds.isEmpty()) return@db emptyList()

        Receipts.selectAll()
            .where {
                (Receipts.profileId inList profileIds) and (Receipts.deletedAt.isNull())
            }
            .orderBy(Receipts.date, SortOrder.DESC)
            .limit(500)
            .map { r ->
                val pid = r[Receipts.profileId].value
                val (pname, owner) = profileMap[pid] ?: ("?" to UUID.randomUUID())
                AccountantReceiptDto(
                    syncId = r[Receipts.syncId].toString(),
                    profileId = pid.toString(),
                    profileName = pname,
                    ownerEmail = emails[owner] ?: "—",
                    merchantName = r[Receipts.merchantName],
                    date = r[Receipts.date].toString(),
                    totalWithVat = r[Receipts.totalWithVat].toPlainString(),
                    currency = r[Receipts.currency],
                    paymentMethod = r[Receipts.paymentMethod],
                )
            }
    }

    /** Faktury všech členů organizace, kde je volající 'accountant'. */
    suspend fun listInvoices(userId: UUID, orgId: UUID): List<AccountantInvoiceDto> = db {
        requireAccountantRole(userId, orgId)

        val profiles = Profiles.selectAll()
            .where {
                (Profiles.organizationId eq orgId) and (Profiles.deletedAt.isNull())
            }
            .toList()
        val profileMap = profiles.associate {
            it[Profiles.id].value to (it[Profiles.name] to it[Profiles.ownerUserId].value)
        }
        val ownerIds = profiles.map { it[Profiles.ownerUserId].value }.distinct()
        val emails = if (ownerIds.isEmpty()) emptyMap() else
            Users.selectAll().where { Users.id inList ownerIds }
                .associate { it[Users.id].value to it[Users.email] }

        val profileIds = profileMap.keys
        if (profileIds.isEmpty()) return@db emptyList()

        Invoices.selectAll()
            .where {
                (Invoices.profileId inList profileIds) and (Invoices.deletedAt.isNull())
            }
            .orderBy(Invoices.issueDate, SortOrder.DESC)
            .limit(500)
            .map { r ->
                val pid = r[Invoices.profileId].value
                val (pname, owner) = profileMap[pid] ?: ("?" to UUID.randomUUID())
                AccountantInvoiceDto(
                    syncId = r[Invoices.syncId].toString(),
                    profileId = pid.toString(),
                    profileName = pname,
                    ownerEmail = emails[owner] ?: "—",
                    invoiceNumber = r[Invoices.invoiceNumber],
                    isExpense = r[Invoices.isExpense],
                    issueDate = r[Invoices.issueDate]?.toString(),
                    dueDate = r[Invoices.dueDate]?.toString(),
                    totalWithVat = r[Invoices.totalWithVat].toPlainString(),
                    currency = r[Invoices.currency],
                    supplierName = r[Invoices.supplierName],
                    customerName = r[Invoices.customerName],
                    paid = r[Invoices.paid],
                )
            }
    }

    private suspend fun requireAccountantRole(userId: UUID, orgId: UUID) {
        val role = db {
            OrganizationMembers
                .selectAll()
                .where {
                    (OrganizationMembers.organizationId eq orgId) and
                        (OrganizationMembers.userId eq userId)
                }
                .singleOrNull()
                ?.get(OrganizationMembers.role)
        }
        if (role !in setOf("accountant", "admin", "owner")) {
            throw ApiException(
                HttpStatusCode.Forbidden,
                "not_accountant",
                "K této organizaci nemáš účetnický přístup.",
            )
        }
    }
}
