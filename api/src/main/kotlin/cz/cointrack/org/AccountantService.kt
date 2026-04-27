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
        val linkedAccountId: String? = null,
        val accountName: String? = null,
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
        val linkedAccountId: String? = null,
        val accountName: String? = null,
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

        val rows = Receipts.selectAll()
            .where {
                (Receipts.profileId inList profileIds) and (Receipts.deletedAt.isNull())
            }
            .orderBy(Receipts.date, SortOrder.DESC)
            .limit(500)
            .toList()

        // Resoluce účtu přes propojenou transakci (Receipts → Transactions.accountId).
        val txIds = rows.mapNotNull { it[Receipts.transactionId]?.value }.distinct()
        val txAccountById: Map<UUID, UUID> = if (txIds.isEmpty()) emptyMap() else
            cz.cointrack.db.Transactions.selectAll()
                .where { cz.cointrack.db.Transactions.id inList txIds }
                .mapNotNull { row ->
                    val tid = row[cz.cointrack.db.Transactions.id].value
                    val aid = row[cz.cointrack.db.Transactions.accountId]?.value
                    if (aid != null) tid to aid else null
                }.toMap()
        val accountIds = txAccountById.values.distinct()
        val accountInfo: Map<UUID, Pair<String, String>> = if (accountIds.isEmpty()) emptyMap() else
            cz.cointrack.db.Accounts.selectAll()
                .where { cz.cointrack.db.Accounts.id inList accountIds }
                .associate {
                    it[cz.cointrack.db.Accounts.id].value to
                        (it[cz.cointrack.db.Accounts.syncId].toString() to it[cz.cointrack.db.Accounts.name])
                }

        rows.map { r ->
            val pid = r[Receipts.profileId].value
            val (pname, owner) = profileMap[pid] ?: ("?" to UUID.randomUUID())
            val txId = r[Receipts.transactionId]?.value
            val accId = txId?.let { txAccountById[it] }
            val accInfo = accId?.let { accountInfo[it] }
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
                linkedAccountId = accInfo?.first,
                accountName = accInfo?.second,
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

        val rows = Invoices.selectAll()
            .where {
                (Invoices.profileId inList profileIds) and (Invoices.deletedAt.isNull())
            }
            .orderBy(Invoices.issueDate, SortOrder.DESC)
            .limit(500)
            .toList()

        val accountIds = rows.mapNotNull { it[Invoices.linkedAccountId]?.value }.distinct()
        val accountInfo: Map<UUID, Pair<String, String>> = if (accountIds.isEmpty()) emptyMap() else
            cz.cointrack.db.Accounts.selectAll()
                .where { cz.cointrack.db.Accounts.id inList accountIds }
                .associate {
                    it[cz.cointrack.db.Accounts.id].value to
                        (it[cz.cointrack.db.Accounts.syncId].toString() to it[cz.cointrack.db.Accounts.name])
                }

        rows.map { r ->
            val pid = r[Invoices.profileId].value
            val (pname, owner) = profileMap[pid] ?: ("?" to UUID.randomUUID())
            val accId = r[Invoices.linkedAccountId]?.value
            val accInfo = accId?.let { accountInfo[it] }
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
                linkedAccountId = accInfo?.first,
                accountName = accInfo?.second,
            )
        }
    }

    /**
     * Hromadný ZIP export pro účetní — `receipts.csv` + `invoices.csv`
     * se všemi doklady org (oba listy s českými hlavičkami a ; jako separator,
     * UTF-8 BOM pro Excel). Vrací bytes ZIP.
     */
    suspend fun exportZip(userId: UUID, orgId: UUID): ByteArray {
        val receipts = listReceipts(userId, orgId)
        val invoices = listInvoices(userId, orgId)

        val baos = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(baos).use { zip ->
            // ── Receipts CSV ──
            zip.putNextEntry(java.util.zip.ZipEntry("receipts.csv"))
            zip.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))  // UTF-8 BOM
            zip.write(buildReceiptsCsv(receipts).toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            // ── Invoices CSV ──
            zip.putNextEntry(java.util.zip.ZipEntry("invoices.csv"))
            zip.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
            zip.write(buildInvoicesCsv(invoices).toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            // ── Souhrn (text) ──
            zip.putNextEntry(java.util.zip.ZipEntry("README.txt"))
            zip.write(buildSummary(receipts, invoices).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        return baos.toByteArray()
    }

    private fun buildReceiptsCsv(items: List<AccountantReceiptDto>): String = buildString {
        appendLine("Datum;Obchodník;Profil;Vlastník;Platba;Částka;Měna;Účet")
        for (r in items) {
            appendLine(
                listOf(
                    r.date,
                    csvEscape(r.merchantName ?: ""),
                    csvEscape(r.profileName),
                    csvEscape(r.ownerEmail),
                    when (r.paymentMethod) { "CASH" -> "Hotově"; "CARD" -> "Kartou"; else -> "" },
                    r.totalWithVat,
                    r.currency,
                    csvEscape(r.accountName ?: ""),
                ).joinToString(";")
            )
        }
    }

    private fun buildInvoicesCsv(items: List<AccountantInvoiceDto>): String = buildString {
        appendLine("Číslo;Typ;Vystaveno;Splatnost;Profil;Vlastník;Dodavatel;Odběratel;Částka;Měna;Uhrazeno;Účet")
        for (i in items) {
            appendLine(
                listOf(
                    csvEscape(i.invoiceNumber ?: ""),
                    if (i.isExpense) "Přijatá" else "Vydaná",
                    i.issueDate ?: "",
                    i.dueDate ?: "",
                    csvEscape(i.profileName),
                    csvEscape(i.ownerEmail),
                    csvEscape(i.supplierName ?: ""),
                    csvEscape(i.customerName ?: ""),
                    i.totalWithVat,
                    i.currency,
                    if (i.paid) "ano" else "ne",
                    csvEscape(i.accountName ?: ""),
                ).joinToString(";")
            )
        }
    }

    private fun buildSummary(
        receipts: List<AccountantReceiptDto>,
        invoices: List<AccountantInvoiceDto>,
    ): String = buildString {
        appendLine("Cointrack export pro účetní")
        appendLine("Vygenerováno: ${java.time.LocalDateTime.now()}")
        appendLine()
        appendLine("Účtenky: ${receipts.size}")
        appendLine("Faktury: ${invoices.size}")
        appendLine("  • Vydané: ${invoices.count { !it.isExpense }}")
        appendLine("  • Přijaté: ${invoices.count { it.isExpense }}")
        appendLine()
        appendLine("Otevři CSV soubory v Excelu (UTF-8 BOM, středník jako oddělovač).")
    }

    private fun csvEscape(s: String): String =
        if (s.contains(';') || s.contains('"') || s.contains('\n')) {
            "\"" + s.replace("\"", "\"\"") + "\""
        } else s

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
