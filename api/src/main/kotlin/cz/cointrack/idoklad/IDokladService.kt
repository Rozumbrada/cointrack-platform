package cz.cointrack.idoklad

import cz.cointrack.db.Invoices
import cz.cointrack.db.Profiles
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class IDokladService(private val client: IDokladClient = IDokladClient()) {
    private val log = LoggerFactory.getLogger(IDokladService::class.java)

    @Serializable
    data class Status(
        val configured: Boolean,
        val clientId: String? = null,         // pro UI náhled, ne celé tajemství
        val lastSyncAt: String? = null,
        val tokenExpiresAt: String? = null,
    )

    @Serializable
    data class SaveCredentialsRequest(
        val profileId: String,
        val clientId: String,
        val clientSecret: String,
    )

    @Serializable
    data class SyncResult(
        val issuedAdded: Int,
        val issuedUpdated: Int,
        val receivedAdded: Int,
        val receivedUpdated: Int,
        val total: Int,
    )

    /** Vrátí status iDoklad připojení pro daný profil. */
    suspend fun status(userId: UUID, profileSyncId: UUID): Status = db {
        val row = profileRowFor(userId, profileSyncId)
        Status(
            configured = !row[Profiles.idokladClientSecretEnc].isNullOrBlank(),
            clientId = row[Profiles.idokladClientId]?.let { mask(it) },
            lastSyncAt = row[Profiles.idokladLastSyncAt]?.toString(),
            tokenExpiresAt = row[Profiles.idokladTokenExpiresAt]?.toString(),
        )
    }

    /** Uloží credentials (Client Secret šifrován AES-GCM). */
    suspend fun saveCredentials(userId: UUID, req: SaveCredentialsRequest) {
        val profileSyncId = UUID.fromString(req.profileId)
        val encSecret = IDokladCrypto.encrypt(req.clientSecret.trim())
        db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            Profiles.update({ Profiles.id eq pid }) {
                it[idokladClientId] = req.clientId.trim()
                it[idokladClientSecretEnc] = encSecret
                // Token cache invalidate — přinutí next sync OAuth refresh
                it[idokladAccessToken] = null
                it[idokladTokenExpiresAt] = null
            }
        }
    }

    /** Smaže credentials. */
    suspend fun clearCredentials(userId: UUID, profileSyncId: UUID) {
        db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            Profiles.update({ Profiles.id eq pid }) {
                it[idokladClientId] = null
                it[idokladClientSecretEnc] = null
                it[idokladAccessToken] = null
                it[idokladTokenExpiresAt] = null
            }
        }
    }

    /**
     * Stáhne všechny faktury z iDokladu a uloží je jako Cointrack Invoice
     * (upsert podle `idokladId`).
     */
    suspend fun sync(userId: UUID, profileSyncId: UUID): SyncResult {
        val (profileDbId, clientId, clientSecret) = db {
            val row = profileRowFor(userId, profileSyncId)
            val cid = row[Profiles.idokladClientId]
                ?: throw ApiException(HttpStatusCode.BadRequest, "no_credentials", "Není uložen Client ID.")
            val encSecret = row[Profiles.idokladClientSecretEnc]
                ?: throw ApiException(HttpStatusCode.BadRequest, "no_credentials", "Není uložen Client Secret.")
            val secret = runCatching { IDokladCrypto.decrypt(encSecret) }
                .getOrElse { throw ApiException(HttpStatusCode.InternalServerError, "decrypt_failed",
                    "Nelze dešifrovat credentials. Možná byl změněn IDOKLAD_ENC_KEY — uložte je znovu.") }
            Triple(row[Profiles.id].value, cid, secret)
        }

        val token = try {
            client.obtainAccessToken(clientId, clientSecret)
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadRequest, "idoklad_auth_failed",
                "iDoklad odmítl credentials: ${e.message}")
        }
        val expiresAt = Instant.now().plusSeconds(token.expires_in.toLong() - 60)

        db {
            Profiles.update({ Profiles.id eq profileDbId }) {
                it[idokladAccessToken] = token.access_token
                it[idokladTokenExpiresAt] = expiresAt
            }
        }

        // Stáhni všechny stránky issued + received
        val issued = fetchAllPages { page ->
            client.listIssuedInvoices(token.access_token, page = page)
        }
        val received = fetchAllPages { page ->
            client.listReceivedInvoices(token.access_token, page = page)
        }

        // Upsert
        var (iAdd, iUpd) = upsertInvoices(profileDbId, issued, isExpense = false)
        var (rAdd, rUpd) = upsertInvoices(profileDbId, received, isExpense = true)

        db {
            Profiles.update({ Profiles.id eq profileDbId }) {
                it[idokladLastSyncAt] = Instant.now()
            }
        }

        return SyncResult(iAdd, iUpd, rAdd, rUpd, total = iAdd + iUpd + rAdd + rUpd)
    }

    private suspend fun fetchAllPages(
        fetch: suspend (page: Int) -> IDokladClient.IDokladInvoicePage,
    ): List<IDokladClient.IDokladInvoice> {
        val out = mutableListOf<IDokladClient.IDokladInvoice>()
        var page = 1
        while (true) {
            val resp = fetch(page)
            out.addAll(resp.Data)
            if (page >= resp.TotalPages) break
            page++
            if (page > 50) break  // safety
        }
        return out
    }

    private suspend fun upsertInvoices(
        profileDbId: UUID,
        items: List<IDokladClient.IDokladInvoice>,
        isExpense: Boolean,
    ): Pair<Int, Int> = db {
        var added = 0
        var updated = 0
        for (inv in items) {
            val idokladId = inv.Id.toString()
            val existing = Invoices.selectAll()
                .where { (Invoices.profileId eq profileDbId) and (Invoices.idokladId eq idokladId) }
                .singleOrNull()

            val total = inv.Prices?.TotalWithVat?.let { BigDecimal.valueOf(it) } ?: BigDecimal.ZERO
            val totalNo = inv.Prices?.TotalWithoutVat?.let { BigDecimal.valueOf(it) }
            val issueDate = inv.DateOfIssue?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
            val dueDate = inv.DateOfMaturity?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
            val now = Instant.now()
            val partnerName = inv.PartnerName ?: ""

            if (existing == null) {
                Invoices.insert {
                    it[syncId] = UUID.randomUUID()
                    it[Invoices.profileId] = EntityID(profileDbId, Profiles)
                    it[Invoices.invoiceNumber] = inv.DocumentNumber
                    it[Invoices.isExpense] = isExpense
                    it[Invoices.issueDate] = issueDate
                    it[Invoices.dueDate] = dueDate
                    it[Invoices.totalWithVat] = total
                    it[Invoices.totalWithoutVat] = totalNo
                    it[Invoices.currency] = inv.CurrencyCode ?: "CZK"
                    it[Invoices.variableSymbol] = inv.VariableSymbol
                    it[Invoices.supplierName] = if (isExpense) partnerName else null
                    it[Invoices.customerName] = if (!isExpense) partnerName else null
                    it[Invoices.note] = inv.Note ?: inv.Description
                    it[Invoices.paid] = inv.IsPaid
                    it[Invoices.idokladId] = idokladId
                    it[Invoices.clientVersion] = 1
                    it[Invoices.updatedAt] = now
                }
                added++
            } else {
                Invoices.update({ Invoices.syncId eq existing[Invoices.syncId] }) {
                    it[Invoices.totalWithVat] = total
                    it[Invoices.totalWithoutVat] = totalNo
                    it[Invoices.dueDate] = dueDate
                    it[Invoices.paid] = inv.IsPaid
                    it[Invoices.note] = inv.Note ?: inv.Description
                    it[Invoices.updatedAt] = now
                }
                updated++
            }
        }
        added to updated
    }

    private fun profileRowFor(userId: UUID, profileSyncId: UUID): org.jetbrains.exposed.sql.ResultRow {
        val row = Profiles.selectAll().where { Profiles.syncId eq profileSyncId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
        if (row[Profiles.ownerUserId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "not_profile_owner", "Profil nepatří přihlášenému uživateli.")
        }
        return row
    }

    private fun mask(s: String): String =
        if (s.length <= 8) "•".repeat(s.length) else s.take(4) + "…" + s.takeLast(4)
}
