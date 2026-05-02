package cz.cointrack.email.inbox

import cz.cointrack.db.Accounts
import cz.cointrack.db.EmailAccounts
import cz.cointrack.db.InvoiceItems
import cz.cointrack.db.Invoices
import cz.cointrack.db.Profiles
import cz.cointrack.db.Transactions
import cz.cointrack.db.db
import cz.cointrack.idoklad.IDokladCrypto
import cz.cointrack.plugins.ApiException
import cz.cointrack.storage.StorageService
import io.ktor.http.HttpStatusCode
import jakarta.mail.Flags
import jakarta.mail.Folder
import jakarta.mail.Message
import jakarta.mail.Multipart
import jakarta.mail.Part
import jakarta.mail.Session
import jakarta.mail.Store
import jakarta.mail.internet.MimeUtility
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.io.ByteArrayOutputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Properties
import java.util.UUID

/**
 * Email inbox service — IMAP fetch + parse + create invoice.
 *
 * Flow per sync:
 *   1. IMAP login (jakarta.mail).
 *   2. Open folder, search UID > last_synced_uid.
 *   3. Per email (max [MAX_EMAILS_PER_SYNC]): fetch headers + body + attachments.
 *   4. Skip duplicates (already-imported message-id).
 *   5. Apply sender_whitelist + subject_filter (volitelné).
 *   6. Pošli do AI (subject + body + attachments) → ParsedEmailInvoice.
 *   7. Pokud AI vrátí isInvoice=true → vytvoř Invoice + items + upload files do MinIO.
 *   8. Pokus o auto-match s existující transakcí → linkedTransactionId + paid=true.
 *   9. Update last_synced_uid + last_synced_at.
 */
class EmailInboxService(
    private val storage: StorageService,
    private val ocr: EmailGeminiOcr,
) {

    private val log = LoggerFactory.getLogger(EmailInboxService::class.java)

    companion object {
        const val MAX_EMAILS_PER_SYNC = 50
        const val IMAP_TIMEOUT_MS = 30_000L
    }

    // ── DTOs ─────────────────────────────────────────────────────────

    @Serializable
    data class CreateAccountRequest(
        val displayLabel: String? = null,
        val provider: String = "IMAP",
        val imapHost: String? = null,
        val imapPort: Int = 993,
        val imapUsername: String? = null,
        val imapPassword: String? = null,        // plain — server zašifruje, neuloží
        val imapSsl: Boolean = true,
        val folder: String = "INBOX",
        val senderWhitelist: String? = null,
        val subjectFilter: String? = null,
        val syncIntervalHours: Int = 6,
    )

    @Serializable
    data class UpdateAccountRequest(
        val displayLabel: String? = null,
        val imapHost: String? = null,
        val imapPort: Int? = null,
        val imapUsername: String? = null,
        val imapPassword: String? = null,        // pokud null, ponecháme staré
        val imapSsl: Boolean? = null,
        val folder: String? = null,
        val senderWhitelist: String? = null,
        val subjectFilter: String? = null,
        val syncIntervalHours: Int? = null,
        val enabled: Boolean? = null,
    )

    @Serializable
    data class TestConnectionRequest(
        val imapHost: String,
        val imapPort: Int = 993,
        val imapUsername: String,
        val imapPassword: String,
        val imapSsl: Boolean = true,
    )

    @Serializable
    data class TestConnectionResult(
        val ok: Boolean,
        val message: String,
        val foldersFound: List<String> = emptyList(),
    )

    @Serializable
    data class EmailAccountDto(
        val id: String,
        val syncId: String,
        val profileSyncId: String,
        val provider: String,
        val displayLabel: String? = null,
        val imapHost: String? = null,
        val imapPort: Int = 993,
        val imapUsername: String? = null,
        val imapSsl: Boolean = true,
        val folder: String = "INBOX",
        val senderWhitelist: String? = null,
        val subjectFilter: String? = null,
        val lastSyncedAt: String? = null,
        val lastSyncError: String? = null,
        val syncIntervalHours: Int = 6,
        val enabled: Boolean = true,
        val createdAt: String,
    )

    @Serializable
    data class SyncResult(
        val ok: Boolean,
        val processed: Int,
        val invoicesCreated: Int,
        val skipped: Int,
        val error: String? = null,
    )

    // ── CRUD ─────────────────────────────────────────────────────────

    suspend fun listAccounts(profileDbId: UUID): List<EmailAccountDto> = db {
        val profileSyncId = Profiles.selectAll()
            .where { Profiles.id eq EntityID(profileDbId, Profiles) }
            .singleOrNull()?.get(Profiles.syncId)?.toString() ?: profileDbId.toString()
        EmailAccounts.selectAll()
            .where { (EmailAccounts.profileId eq EntityID(profileDbId, Profiles)) and EmailAccounts.deletedAt.isNull() }
            .orderBy(EmailAccounts.createdAt, SortOrder.DESC)
            .map { it.toDto(profileSyncId) }
    }

    suspend fun getAccount(accountId: UUID, profileDbId: UUID): EmailAccountDto = db {
        val profileSyncId = Profiles.selectAll()
            .where { Profiles.id eq EntityID(profileDbId, Profiles) }
            .singleOrNull()?.get(Profiles.syncId)?.toString() ?: profileDbId.toString()
        EmailAccounts.selectAll()
            .where {
                (EmailAccounts.id eq EntityID(accountId, EmailAccounts)) and
                    (EmailAccounts.profileId eq EntityID(profileDbId, Profiles)) and
                    EmailAccounts.deletedAt.isNull()
            }
            .singleOrNull()?.toDto(profileSyncId)
            ?: throw ApiException(HttpStatusCode.NotFound, "email_account_not_found", "Email schránka nenalezena.")
    }

    suspend fun createAccount(profileDbId: UUID, req: CreateAccountRequest): EmailAccountDto {
        if (req.imapHost.isNullOrBlank() || req.imapUsername.isNullOrBlank() || req.imapPassword.isNullOrBlank()) {
            throw ApiException(HttpStatusCode.BadRequest, "missing_credentials",
                "Chybí IMAP host, username nebo heslo.")
        }
        // Test connection PŘED uložením — fail-fast
        val test = testConnection(TestConnectionRequest(
            imapHost = req.imapHost, imapPort = req.imapPort,
            imapUsername = req.imapUsername, imapPassword = req.imapPassword, imapSsl = req.imapSsl,
        ))
        if (!test.ok) {
            throw ApiException(HttpStatusCode.BadRequest, "imap_connect_failed", test.message)
        }

        val newId = UUID.randomUUID()
        val newSyncId = UUID.randomUUID()
        val now = Instant.now()
        return db {
            val profileSyncId = Profiles.selectAll()
                .where { Profiles.id eq EntityID(profileDbId, Profiles) }
                .singleOrNull()?.get(Profiles.syncId)?.toString() ?: profileDbId.toString()
            EmailAccounts.insertAndGetId {
                it[EmailAccounts.id] = newId
                it[EmailAccounts.syncId] = newSyncId
                it[EmailAccounts.profileId] = EntityID(profileDbId, Profiles)
                it[EmailAccounts.provider] = req.provider
                it[EmailAccounts.displayLabel] = req.displayLabel
                it[EmailAccounts.imapHost] = req.imapHost
                it[EmailAccounts.imapPort] = req.imapPort
                it[EmailAccounts.imapUsername] = req.imapUsername
                it[EmailAccounts.imapPasswordEnc] = IDokladCrypto.encrypt(req.imapPassword)
                it[EmailAccounts.imapSsl] = req.imapSsl
                it[EmailAccounts.folder] = req.folder
                it[EmailAccounts.senderWhitelist] = req.senderWhitelist?.takeIf { s -> s.isNotBlank() }
                it[EmailAccounts.subjectFilter] = req.subjectFilter?.takeIf { s -> s.isNotBlank() }
                it[EmailAccounts.syncIntervalHours] = req.syncIntervalHours.coerceIn(1, 168)
                it[EmailAccounts.enabled] = true
                it[EmailAccounts.createdAt] = now
                it[EmailAccounts.updatedAt] = now
            }
            EmailAccounts.selectAll().where { EmailAccounts.id eq EntityID(newId, EmailAccounts) }
                .single().toDto(profileSyncId)
        }
    }

    suspend fun updateAccount(accountId: UUID, profileDbId: UUID, req: UpdateAccountRequest): EmailAccountDto = db {
        EmailAccounts.selectAll()
            .where {
                (EmailAccounts.id eq EntityID(accountId, EmailAccounts)) and
                    (EmailAccounts.profileId eq EntityID(profileDbId, Profiles)) and
                    EmailAccounts.deletedAt.isNull()
            }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "email_account_not_found", "Schránka neexistuje.")

        val profileSyncId = Profiles.selectAll()
            .where { Profiles.id eq EntityID(profileDbId, Profiles) }
            .singleOrNull()?.get(Profiles.syncId)?.toString() ?: profileDbId.toString()

        EmailAccounts.update({ EmailAccounts.id eq EntityID(accountId, EmailAccounts) }) {
            req.displayLabel?.let { v -> it[EmailAccounts.displayLabel] = v }
            req.imapHost?.let { v -> it[EmailAccounts.imapHost] = v }
            req.imapPort?.let { v -> it[EmailAccounts.imapPort] = v }
            req.imapUsername?.let { v -> it[EmailAccounts.imapUsername] = v }
            req.imapPassword?.takeIf { p -> p.isNotBlank() }?.let { v ->
                it[EmailAccounts.imapPasswordEnc] = IDokladCrypto.encrypt(v)
            }
            req.imapSsl?.let { v -> it[EmailAccounts.imapSsl] = v }
            req.folder?.let { v -> it[EmailAccounts.folder] = v }
            req.senderWhitelist?.let { v -> it[EmailAccounts.senderWhitelist] = v.takeIf { s -> s.isNotBlank() } }
            req.subjectFilter?.let { v -> it[EmailAccounts.subjectFilter] = v.takeIf { s -> s.isNotBlank() } }
            req.syncIntervalHours?.let { v -> it[EmailAccounts.syncIntervalHours] = v.coerceIn(1, 168) }
            req.enabled?.let { v -> it[EmailAccounts.enabled] = v }
            it[EmailAccounts.updatedAt] = Instant.now()
        }
        EmailAccounts.selectAll().where { EmailAccounts.id eq EntityID(accountId, EmailAccounts) }
            .single().toDto(profileSyncId)
    }

    suspend fun deleteAccount(accountId: UUID, profileDbId: UUID) = db {
        val now = Instant.now()
        EmailAccounts.update({
            (EmailAccounts.id eq EntityID(accountId, EmailAccounts)) and
                (EmailAccounts.profileId eq EntityID(profileDbId, Profiles))
        }) {
            it[EmailAccounts.deletedAt] = now
            it[EmailAccounts.updatedAt] = now
        }
    }

    // ── Test connection ──────────────────────────────────────────────

    suspend fun testConnection(req: TestConnectionRequest): TestConnectionResult = withContext(Dispatchers.IO) {
        try {
            val store = openImapStore(req.imapHost, req.imapPort, req.imapSsl, req.imapUsername, req.imapPassword)
            try {
                val folders = store.defaultFolder.list().map { it.name }
                TestConnectionResult(ok = true, message = "Připojení OK", foldersFound = folders)
            } finally {
                runCatching { store.close() }
            }
        } catch (e: Exception) {
            log.warn("IMAP test connection failed: {}", e.message)
            TestConnectionResult(ok = false, message = e.message ?: "Připojení selhalo")
        }
    }

    // ── Sync (manual + worker) ───────────────────────────────────────

    suspend fun syncAccount(accountId: UUID): SyncResult = withContext(Dispatchers.IO) {
        val acc = db {
            EmailAccounts.selectAll()
                .where { EmailAccounts.id eq EntityID(accountId, EmailAccounts) }
                .singleOrNull()
        } ?: return@withContext SyncResult(false, 0, 0, 0, "Schránka neexistuje")

        if (acc[EmailAccounts.deletedAt] != null || !acc[EmailAccounts.enabled]) {
            return@withContext SyncResult(false, 0, 0, 0, "Schránka je vypnutá nebo smazaná")
        }
        val host = acc[EmailAccounts.imapHost]
            ?: return@withContext SyncResult(false, 0, 0, 0, "Není nakonfigurovaný IMAP host")
        val port = acc[EmailAccounts.imapPort]
        val ssl = acc[EmailAccounts.imapSsl]
        val username = acc[EmailAccounts.imapUsername]
            ?: return@withContext SyncResult(false, 0, 0, 0, "Není nastavený username")
        val passwordEnc = acc[EmailAccounts.imapPasswordEnc]
            ?: return@withContext SyncResult(false, 0, 0, 0, "Není nastavené heslo")
        val password = runCatching { IDokladCrypto.decrypt(passwordEnc) }
            .getOrElse {
                return@withContext SyncResult(false, 0, 0, 0,
                    "Nelze dešifrovat heslo (změnil se IDOKLAD_ENC_KEY?). Zadej heslo znovu.")
            }
        val folderName = acc[EmailAccounts.folder]
        val profileDbId = acc[EmailAccounts.profileId].value
        val emailAccountDbId = acc[EmailAccounts.id].value
        val lastUid = acc[EmailAccounts.lastSyncedUid]?.toLongOrNull() ?: 0L
        val senderWhitelist = acc[EmailAccounts.senderWhitelist]
            ?.split(",")?.map { it.trim().lowercase() }?.filter { it.isNotBlank() }
            ?: emptyList()
        val subjectFilterRegex = acc[EmailAccounts.subjectFilter]?.takeIf { it.isNotBlank() }
            ?.let { runCatching { Regex(it, RegexOption.IGNORE_CASE) }.getOrNull() }

        val store = try {
            openImapStore(host, port, ssl, username, password)
        } catch (e: Exception) {
            log.warn("IMAP login failed for account {}: {}", accountId, e.message)
            updateLastSync(emailAccountDbId, error = "Login selhal: ${e.message}")
            return@withContext SyncResult(false, 0, 0, 0, "IMAP login selhal: ${e.message}")
        }

        var processed = 0
        var created = 0
        var skipped = 0
        var lastSeenUid = lastUid
        try {
            val folder = (store.getFolder(folderName)
                ?: throw IllegalStateException("Folder $folderName neexistuje"))
            folder.open(Folder.READ_ONLY)
            val uidFolder = folder as jakarta.mail.UIDFolder
            // Stáhni jen zprávy s UID > last_synced_uid (max MAX_EMAILS_PER_SYNC).
            // Některé servery nepodporují range, použijeme `getMessagesByUID(start, LASTUID)`.
            val messages = if (lastUid > 0) {
                uidFolder.getMessagesByUID(lastUid + 1, jakarta.mail.UIDFolder.LASTUID)
            } else {
                // První sync — vezmeme posledních MAX_EMAILS_PER_SYNC
                val total = folder.messageCount
                if (total == 0) emptyArray() else folder.getMessages(
                    maxOf(1, total - MAX_EMAILS_PER_SYNC + 1), total
                )
            }

            val toProcess = messages.take(MAX_EMAILS_PER_SYNC)
            for (msg in toProcess) {
                processed++
                try {
                    val uid = uidFolder.getUID(msg)
                    if (uid > lastSeenUid) lastSeenUid = uid

                    val sender = msg.from?.firstOrNull()?.toString()?.lowercase() ?: ""
                    val subject = msg.subject ?: ""
                    val messageId = (msg.getHeader("Message-ID")?.firstOrNull() ?: msg.subject + msg.sentDate)
                        .take(255)
                    val receivedAt = msg.receivedDate?.toInstant() ?: msg.sentDate?.toInstant() ?: Instant.now()

                    // Filter: sender_whitelist (pokud je) + subject_filter (pokud je).
                    // Filtruji POUZE pokud filter exists — žádný filter = pusť všechno.
                    if (senderWhitelist.isNotEmpty()) {
                        val matches = senderWhitelist.any { sender.contains(it) }
                        if (!matches) { skipped++; continue }
                    }
                    if (subjectFilterRegex != null && !subjectFilterRegex.containsMatchIn(subject)) {
                        skipped++; continue
                    }

                    // Dedup: už jsme tuhle Message-ID pro tenhle profil zpracovali?
                    val alreadyExists = db {
                        Invoices.selectAll()
                            .where {
                                (Invoices.profileId eq EntityID(profileDbId, Profiles)) and
                                    (Invoices.emailMessageId eq messageId) and
                                    Invoices.deletedAt.isNull()
                            }.any()
                    }
                    if (alreadyExists) { skipped++; continue }

                    // Body + attachments
                    val (bodyText, attachments) = extractBodyAndAttachments(msg)

                    // AI extrakce
                    val parsed = ocr.extract(EmailGeminiOcr.Input(
                        emailSubject = subject,
                        emailBody = bodyText,
                        attachments = attachments.map {
                            EmailGeminiOcr.Attachment(
                                filename = it.filename,
                                mimeType = it.mimeType,
                                bytes = it.bytes,
                            )
                        },
                    ))

                    if (parsed == null) {
                        // Není to faktura
                        skipped++
                        continue
                    }

                    // Upload příloh do MinIO
                    val fileKeys = attachments.mapNotNull { att ->
                        runCatching {
                            storage.uploadDirectly(
                                bytes = att.bytes,
                                contentType = att.mimeType,
                                purpose = "invoice",
                            )
                        }.getOrNull()
                    }

                    // Vytvoř invoice
                    db {
                        val invoiceId = UUID.randomUUID()
                        val invoiceSyncId = UUID.randomUUID()
                        Invoices.insertAndGetId {
                            it[Invoices.id] = invoiceId
                            it[Invoices.syncId] = invoiceSyncId
                            it[Invoices.profileId] = EntityID(profileDbId, Profiles)
                            it[Invoices.invoiceNumber] = parsed.invoiceNumber
                            it[Invoices.isExpense] = parsed.isExpense
                            it[Invoices.issueDate] = parsed.issueDate?.let {
                                runCatching { LocalDate.parse(it) }.getOrNull()
                            } ?: receivedAt.atZone(ZoneId.systemDefault()).toLocalDate()
                            it[Invoices.dueDate] = parsed.dueDate?.let {
                                runCatching { LocalDate.parse(it) }.getOrNull()
                            }
                            it[Invoices.totalWithVat] = parsed.totalWithVat?.toBigDecimal()?.setScale(2, RoundingMode.HALF_UP)
                                ?: BigDecimal.ZERO
                            it[Invoices.totalWithoutVat] = parsed.totalWithoutVat?.toBigDecimal()?.setScale(2, RoundingMode.HALF_UP)
                            it[Invoices.currency] = parsed.currency ?: "CZK"
                            it[Invoices.paymentMethod] = parsed.paymentMethod ?: "BANK_TRANSFER"
                            it[Invoices.variableSymbol] = parsed.variableSymbol
                            it[Invoices.bankAccount] = parsed.bankAccount?.let { ba ->
                                if (parsed.bankCode != null && !ba.contains("/")) "$ba/${parsed.bankCode}" else ba
                            }
                            it[Invoices.paid] = false
                            it[Invoices.supplierName] = parsed.supplierName
                            it[Invoices.supplierIco] = parsed.supplierIco
                            it[Invoices.supplierDic] = parsed.supplierDic
                            it[Invoices.supplierStreet] = parsed.supplierStreet
                            it[Invoices.supplierCity] = parsed.supplierCity
                            it[Invoices.supplierZip] = parsed.supplierZip
                            it[Invoices.customerName] = parsed.customerName
                            it[Invoices.fileKeys] = JsonArray(fileKeys.map { JsonPrimitive(it) }).toString()
                            it[Invoices.originSource] = "email"
                            it[Invoices.emailAccountId] = EntityID(emailAccountDbId, EmailAccounts)
                            it[Invoices.emailSubject] = subject.take(512)
                            it[Invoices.emailSender] = sender.take(255)
                            it[Invoices.emailMessageId] = messageId
                            it[Invoices.emailReceivedAt] = receivedAt
                            it[Invoices.createdAt] = Instant.now()
                            it[Invoices.updatedAt] = Instant.now()
                            it[Invoices.clientVersion] = 1L
                        }
                        // Items
                        for ((idx, item) in parsed.items.withIndex()) {
                            InvoiceItems.insert {
                                it[InvoiceItems.id] = UUID.randomUUID()
                                it[InvoiceItems.syncId] = UUID.randomUUID()
                                it[InvoiceItems.invoiceId] = EntityID(invoiceId, Invoices)
                                it[InvoiceItems.name] = item.name.take(256)
                                it[InvoiceItems.quantity] = item.quantity.toBigDecimal()
                                it[InvoiceItems.totalPriceWithVat] = (item.totalPrice ?: 0.0).toBigDecimal()
                                    .setScale(2, RoundingMode.HALF_UP)
                                it[InvoiceItems.vatRate] = item.vatRate.toBigDecimal()
                                it[InvoiceItems.position] = idx
                                it[InvoiceItems.createdAt] = Instant.now()
                                it[InvoiceItems.updatedAt] = Instant.now()
                                it[InvoiceItems.clientVersion] = 1L
                            }
                        }

                        // Auto-match s tx (částka ±0.01 + datum ±2 dny + IČO)
                        autoMatchInvoiceToTransaction(invoiceId, profileDbId, parsed)
                    }
                    created++
                } catch (e: Exception) {
                    log.warn("Failed to process email msg in account {}: {}", accountId, e.message)
                    skipped++
                }
            }
            folder.close(false)

            updateLastSync(
                accountDbId = emailAccountDbId,
                newLastUid = lastSeenUid,
                error = null,
            )
            SyncResult(ok = true, processed = processed, invoicesCreated = created, skipped = skipped)
        } catch (e: Exception) {
            log.warn("IMAP sync failed for account {}: {}", accountId, e.message, e)
            updateLastSync(emailAccountDbId, error = e.message)
            SyncResult(false, processed, created, skipped, e.message)
        } finally {
            runCatching { store.close() }
        }
    }

    private fun openImapStore(host: String, port: Int, ssl: Boolean, username: String, password: String): Store {
        val protocol = if (ssl) "imaps" else "imap"
        val props = Properties().apply {
            put("mail.store.protocol", protocol)
            put("mail.imap.host", host)
            put("mail.imap.port", port.toString())
            put("mail.imaps.host", host)
            put("mail.imaps.port", port.toString())
            put("mail.imap.ssl.enable", ssl.toString())
            put("mail.imap.connectiontimeout", IMAP_TIMEOUT_MS.toString())
            put("mail.imap.timeout", IMAP_TIMEOUT_MS.toString())
            put("mail.imaps.connectiontimeout", IMAP_TIMEOUT_MS.toString())
            put("mail.imaps.timeout", IMAP_TIMEOUT_MS.toString())
        }
        val session = Session.getInstance(props)
        val store = session.getStore(protocol)
        store.connect(host, port, username, password)
        return store
    }

    private data class ExtractedAttachment(val filename: String, val mimeType: String, val bytes: ByteArray)

    private fun extractBodyAndAttachments(msg: Message): Pair<String?, List<ExtractedAttachment>> {
        val attachments = mutableListOf<ExtractedAttachment>()
        val plainTextBody = StringBuilder()

        fun walk(part: Part) {
            try {
                val disposition = part.disposition?.lowercase()
                val filenameRaw = part.fileName
                val filename = filenameRaw?.let {
                    runCatching { MimeUtility.decodeText(it) }.getOrDefault(it)
                }
                val mimeType = part.contentType?.lowercase() ?: ""

                // Příloha (PDF/JPG/PNG/HEIC) — bez ohledu na disposition
                val isInvoiceAttachment = filename != null && (
                    mimeType.contains("pdf") ||
                        mimeType.contains("image/") ||
                        filename.lowercase().endsWith(".pdf") ||
                        filename.lowercase().matches(Regex(".+\\.(jpg|jpeg|png|heic|webp|gif|tiff)$"))
                    )
                if (isInvoiceAttachment) {
                    val bytes = part.inputStream.use { it.readAllBytes() }
                    val cleanMime = when {
                        mimeType.contains("pdf") -> "application/pdf"
                        mimeType.contains("png") -> "image/png"
                        mimeType.contains("jpeg") || mimeType.contains("jpg") -> "image/jpeg"
                        mimeType.contains("webp") -> "image/webp"
                        mimeType.contains("heic") -> "image/heic"
                        mimeType.startsWith("image/") -> mimeType.substringBefore(";").trim()
                        else -> "application/octet-stream"
                    }
                    if (bytes.isNotEmpty() && bytes.size < 20 * 1024 * 1024) { // 20MB hard cap
                        attachments.add(ExtractedAttachment(filename ?: "attachment", cleanMime, bytes))
                    }
                    return
                }

                // Multipart — projdi children
                val content = runCatching { part.content }.getOrNull()
                if (content is Multipart) {
                    for (i in 0 until content.count) walk(content.getBodyPart(i))
                    return
                }

                // Plain/HTML text body
                if (mimeType.startsWith("text/")) {
                    val text = (content as? String)
                        ?: runCatching { part.inputStream.use { String(it.readAllBytes(), Charsets.UTF_8) } }.getOrNull()
                    if (text != null && plainTextBody.length < 16_000) {
                        if (mimeType.startsWith("text/html")) {
                            // Stripped HTML — naive ale stačí pro AI vstup
                            val stripped = text
                                .replace(Regex("<script[^>]*>[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
                                .replace(Regex("<style[^>]*>[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
                                .replace(Regex("<[^>]+>"), " ")
                                .replace(Regex("&nbsp;|&amp;|&lt;|&gt;|&quot;"), " ")
                                .replace(Regex("\\s+"), " ")
                            plainTextBody.append(stripped).append("\n")
                        } else {
                            plainTextBody.append(text).append("\n")
                        }
                    }
                }
            } catch (e: Exception) {
                log.debug("Skipped part: {}", e.message)
            }
        }
        walk(msg)
        return plainTextBody.toString().takeIf { it.isNotBlank() } to attachments
    }

    private fun updateLastSync(accountDbId: UUID, newLastUid: Long? = null, error: String? = null) {
        runCatching {
            kotlinx.coroutines.runBlocking {
                db {
                    EmailAccounts.update({ EmailAccounts.id eq EntityID(accountDbId, EmailAccounts) }) {
                        it[EmailAccounts.lastSyncedAt] = Instant.now()
                        if (newLastUid != null) it[EmailAccounts.lastSyncedUid] = newLastUid.toString()
                        it[EmailAccounts.lastSyncError] = error
                        it[EmailAccounts.updatedAt] = Instant.now()
                    }
                }
            }
        }
    }

    /**
     * Auto-match: hledá tx ve stejném profilu, ve stejné měně, s amount blízkým
     * `parsed.totalWithVat` (±0.01) a datem ±2 dny od `issueDate` nebo `dueDate`.
     * Bonus match na supplierIco (v `bankCounterpartyName` nebo description).
     */
    private fun org.jetbrains.exposed.sql.Transaction.autoMatchInvoiceToTransaction(
        invoiceId: UUID, profileDbId: UUID, parsed: ParsedEmailInvoice,
    ) {
        val total = parsed.totalWithVat ?: return
        val totalDec = total.toBigDecimal().setScale(2, RoundingMode.HALF_UP)
        val tolerance = BigDecimal("0.01")
        val dateRef = parsed.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: parsed.issueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: return
        val from = dateRef.minusDays(2)
        val to = dateRef.plusDays(2)

        // Pro EXPENSE invoice hledáme negativní tx (z účtu odešlo); pro INCOME pozitivní.
        val expectedSign = if (parsed.isExpense) -BigDecimal.ONE else BigDecimal.ONE
        val matchingTx = Transactions.selectAll()
            .where {
                (Transactions.profileId eq EntityID(profileDbId, Profiles)) and
                    Transactions.deletedAt.isNull() and
                    (Transactions.date greaterEq from) and
                    (Transactions.date lessEq to)
            }
            .firstOrNull { row ->
                val amount = row[Transactions.amount]
                val signMatch = if (parsed.isExpense) amount.signum() < 0 else amount.signum() > 0
                if (!signMatch) return@firstOrNull false
                val absAmount = amount.abs()
                (absAmount - totalDec).abs() <= tolerance
            }

        if (matchingTx != null) {
            Invoices.update({ Invoices.id eq EntityID(invoiceId, Invoices) }) {
                it[Invoices.linkedTransactionId] = matchingTx[Transactions.id]
                it[Invoices.linkedAccountId] = matchingTx[Transactions.accountId]
                it[Invoices.paid] = true
                it[Invoices.updatedAt] = Instant.now()
            }
            log.info("Auto-matched invoice {} to tx {}", invoiceId, matchingTx[Transactions.id].value)
        }
        // Else: nepřiřazeno; user pak v UI klikne "Zaplatit"
        @Suppress("UNUSED_VARIABLE") val _suppress = expectedSign
    }

    /** Najde všechny účty, které jsou enabled a `lastSyncedAt + syncIntervalHours < now()` (pro worker). */
    suspend fun findDueAccounts(): List<UUID> = db {
        val now = Instant.now()
        EmailAccounts.selectAll()
            .where { (EmailAccounts.enabled eq true) and EmailAccounts.deletedAt.isNull() }
            .toList()
            .filter { row ->
                val last = row[EmailAccounts.lastSyncedAt] ?: return@filter true
                val intervalHours = row[EmailAccounts.syncIntervalHours].coerceAtLeast(1)
                last.plusSeconds(intervalHours * 3600L) <= now
            }
            .map { it[EmailAccounts.id].value }
    }

    private fun org.jetbrains.exposed.sql.ResultRow.toDto(profileSyncId: String): EmailAccountDto = EmailAccountDto(
        id = this[EmailAccounts.id].value.toString(),
        syncId = this[EmailAccounts.syncId].toString(),
        profileSyncId = profileSyncId,
        provider = this[EmailAccounts.provider],
        displayLabel = this[EmailAccounts.displayLabel],
        imapHost = this[EmailAccounts.imapHost],
        imapPort = this[EmailAccounts.imapPort],
        imapUsername = this[EmailAccounts.imapUsername],
        imapSsl = this[EmailAccounts.imapSsl],
        folder = this[EmailAccounts.folder],
        senderWhitelist = this[EmailAccounts.senderWhitelist],
        subjectFilter = this[EmailAccounts.subjectFilter],
        lastSyncedAt = this[EmailAccounts.lastSyncedAt]?.toString(),
        lastSyncError = this[EmailAccounts.lastSyncError],
        syncIntervalHours = this[EmailAccounts.syncIntervalHours],
        enabled = this[EmailAccounts.enabled],
        createdAt = this[EmailAccounts.createdAt].toString(),
    )
}
