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

    @Serializable
    data class CreateInvoiceItemDto(
        val name: String,
        val quantity: Double = 1.0,
        val unitPrice: Double,
        val unitName: String = "ks",
    )

    @Serializable
    data class CreateInvoiceRequestDto(
        val profileId: String,
        val partnerName: String,
        val partnerEmail: String? = null,
        val partnerStreet: String? = null,
        val partnerCity: String? = null,
        val partnerPostalCode: String? = null,
        val partnerIco: String? = null,
        val partnerDic: String? = null,
        val dateOfIssue: String,        // YYYY-MM-DD
        val dateOfMaturity: String,     // YYYY-MM-DD
        val description: String? = null,
        val note: String? = null,
        val variableSymbol: String? = null,
        val currencyCode: String = "CZK",
        val items: List<CreateInvoiceItemDto>,
    )

    @Serializable
    data class CreateInvoiceResponse(
        val idokladId: String,
        val invoiceNumber: String?,
        val totalWithVat: String,
        val cointrackInvoiceSyncId: String,
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

        // Stáhni všechny stránky issued + received. iDoklad API občas vrací
        // 4xx/5xx nebo deserializace selže (neznámý schema field) — chytáme,
        // logujeme a vyhodíme srozumitelnou ApiException, ať klient vidí
        // konkrétní problém místo "Internal Server Error".
        val issued = try {
            fetchAllPages { page -> client.listIssuedInvoices(token.access_token, page = page) }
        } catch (e: IDokladException) {
            log.warn("iDoklad listIssuedInvoices selhal: {}", e.message)
            throw ApiException(
                HttpStatusCode.BadGateway, "idoklad_fetch_failed",
                "iDoklad: ${e.message?.take(200) ?: "neznámá chyba"}",
            )
        }
        val received = try {
            fetchAllPages { page -> client.listReceivedInvoices(token.access_token, page = page) }
        } catch (e: IDokladException) {
            log.warn("iDoklad listReceivedInvoices selhal: {}", e.message)
            throw ApiException(
                HttpStatusCode.BadGateway, "idoklad_fetch_failed",
                "iDoklad: ${e.message?.take(200) ?: "neznámá chyba"}",
            )
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
            val items = resp.Data.Items
            if (items.isEmpty()) break
            out.addAll(items)
            // Pagination meta je v různých iDoklad endpointech různě pojmenovaná
            // — TotalPagesCount není garantované. Místo toho iterujeme dokud
            // dostáváme nějaké Items. Safety stop: 50 stránek (= 1000 faktur
            // při default pageSize 20).
            page++
            if (page > 50) break
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

    /** Získá platný access token (z cache nebo nový). */
    private suspend fun ensureToken(profileDbId: UUID): String {
        val (cachedToken, cachedExpiry, clientId, clientSecret) = db {
            val row = Profiles.selectAll().where { Profiles.id eq profileDbId }.single()
            val cid = row[Profiles.idokladClientId]
                ?: throw ApiException(HttpStatusCode.BadRequest, "no_credentials", "Není uložen Client ID.")
            val encSecret = row[Profiles.idokladClientSecretEnc]
                ?: throw ApiException(HttpStatusCode.BadRequest, "no_credentials", "Není uložen Client Secret.")
            val secret = runCatching { IDokladCrypto.decrypt(encSecret) }
                .getOrElse { throw ApiException(HttpStatusCode.InternalServerError, "decrypt_failed",
                    "Nelze dešifrovat credentials.") }
            arrayOf(row[Profiles.idokladAccessToken], row[Profiles.idokladTokenExpiresAt], cid, secret)
        }
        // Token cached and still valid (>60s buffer)
        val expiry = cachedExpiry as? Instant
        if (cachedToken != null && expiry != null && expiry.isAfter(Instant.now().plusSeconds(60))) {
            return cachedToken as String
        }
        // Refresh
        val token = try {
            client.obtainAccessToken(clientId as String, clientSecret as String)
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadRequest, "idoklad_auth_failed",
                "iDoklad odmítl credentials: ${e.message}")
        }
        val newExpiry = Instant.now().plusSeconds(token.expires_in.toLong() - 60)
        db {
            Profiles.update({ Profiles.id eq profileDbId }) {
                it[idokladAccessToken] = token.access_token
                it[idokladTokenExpiresAt] = newExpiry
            }
        }
        return token.access_token
    }

    /** Vytvoří fakturu v iDokladu + uloží ji jako Cointrack Invoice. */
    suspend fun createInvoice(userId: UUID, req: CreateInvoiceRequestDto): CreateInvoiceResponse {
        val profileSyncId = UUID.fromString(req.profileId)
        val profileDbId = db { profileRowFor(userId, profileSyncId)[Profiles.id].value }
        val token = ensureToken(profileDbId)

        val idokladReq = IDokladClient.CreateInvoiceRequest(
            PartnerName = req.partnerName,
            PartnerEmail = req.partnerEmail,
            PartnerStreet = req.partnerStreet,
            PartnerCity = req.partnerCity,
            PartnerPostalCode = req.partnerPostalCode,
            PartnerIdentificationNumber = req.partnerIco,
            PartnerVatIdentificationNumber = req.partnerDic,
            DateOfIssue = req.dateOfIssue,
            DateOfMaturity = req.dateOfMaturity,
            Description = req.description,
            Note = req.note,
            VariableSymbol = req.variableSymbol,
            CurrencyCode = req.currencyCode,
            IsVatPayer = false,
            Items = req.items.map {
                IDokladClient.CreateInvoiceItem(
                    Name = it.name,
                    Amount = it.quantity,
                    UnitPrice = it.unitPrice,
                    UnitName = it.unitName,
                )
            },
        )

        val created = try {
            client.createInvoice(token, idokladReq)
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadGateway, "idoklad_create_failed",
                "iDoklad odmítl fakturu: ${e.message}")
        }

        // Ulož do Cointrack invoices
        val cointrackSyncId = UUID.randomUUID()
        val now = Instant.now()
        val total = created.Prices?.TotalWithVat?.let { BigDecimal.valueOf(it) } ?: BigDecimal.ZERO
        db {
            Invoices.insert {
                it[syncId] = cointrackSyncId
                it[Invoices.profileId] = EntityID(profileDbId, Profiles)
                it[Invoices.invoiceNumber] = created.DocumentNumber
                it[Invoices.isExpense] = false
                it[Invoices.issueDate] = LocalDate.parse(req.dateOfIssue)
                it[Invoices.dueDate] = LocalDate.parse(req.dateOfMaturity)
                it[Invoices.totalWithVat] = total
                it[Invoices.currency] = req.currencyCode
                it[Invoices.variableSymbol] = req.variableSymbol
                it[Invoices.customerName] = req.partnerName
                it[Invoices.note] = req.note ?: req.description
                it[Invoices.paid] = false
                it[Invoices.idokladId] = created.Id.toString()
                it[Invoices.clientVersion] = 1
                it[Invoices.updatedAt] = now
            }
        }

        return CreateInvoiceResponse(
            idokladId = created.Id.toString(),
            invoiceNumber = created.DocumentNumber,
            totalWithVat = total.toPlainString(),
            cointrackInvoiceSyncId = cointrackSyncId.toString(),
        )
    }

    /** Označí fakturu v iDokladu jako zaplacenou + sync do Cointrack. */
    suspend fun markPaid(userId: UUID, profileSyncId: UUID, idokladId: Int, paymentDate: LocalDate) {
        val profileDbId = db { profileRowFor(userId, profileSyncId)[Profiles.id].value }
        val token = ensureToken(profileDbId)
        try {
            client.markInvoicePaid(token, idokladId, paymentDate.toString())
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadGateway, "idoklad_markpaid_failed",
                "iDoklad nepřijal mark-paid: ${e.message}")
        }
        db {
            Invoices.update({
                (Invoices.profileId eq profileDbId) and (Invoices.idokladId eq idokladId.toString())
            }) {
                it[Invoices.paid] = true
                it[Invoices.updatedAt] = Instant.now()
            }
        }
    }

    /** Stáhne PDF faktury z iDokladu (proxy stream). */
    suspend fun getPdf(userId: UUID, profileSyncId: UUID, idokladId: Int): ByteArray {
        val profileDbId = db { profileRowFor(userId, profileSyncId)[Profiles.id].value }
        val token = ensureToken(profileDbId)
        return try {
            client.getInvoicePdf(token, idokladId)
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadGateway, "idoklad_pdf_failed",
                "iDoklad nevrátil PDF: ${e.message}")
        }
    }

    /** Pošle fakturu zákazníkovi přes iDoklad email. */
    suspend fun sendEmail(userId: UUID, profileSyncId: UUID, idokladId: Int, to: String?) {
        val profileDbId = db { profileRowFor(userId, profileSyncId)[Profiles.id].value }
        val token = ensureToken(profileDbId)
        try {
            client.sendInvoiceMail(token, idokladId, to)
        } catch (e: IDokladException) {
            throw ApiException(HttpStatusCode.BadGateway, "idoklad_email_failed",
                "iDoklad nevypadl email: ${e.message}")
        }
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
