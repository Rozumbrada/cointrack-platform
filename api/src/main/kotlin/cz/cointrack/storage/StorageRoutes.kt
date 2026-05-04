package cz.cointrack.storage

import cz.cointrack.db.AccountShares
import cz.cointrack.db.Accounts
import cz.cointrack.db.Files
import cz.cointrack.db.Invoices
import cz.cointrack.db.LoyaltyCards
import cz.cointrack.db.OrganizationMembers
import cz.cointrack.db.Organizations
import cz.cointrack.db.ProfilePermissions
import cz.cointrack.db.Profiles
import cz.cointrack.db.Receipts
import cz.cointrack.db.Transactions
import cz.cointrack.db.Warranties
import cz.cointrack.db.db
import cz.cointrack.sharing.AccountShareService
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.Transaction
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import java.time.Instant
import java.util.UUID

@Serializable
data class UploadUrlRequest(
    val contentType: String,
    val purpose: String,     // receipt | invoice | warranty | avatar
    val sizeBytes: Long? = null,
)

@Serializable
data class UploadUrlResponse(
    val uploadUrl: String,
    val storageKey: String,
    val expiresIn: Int,   // sekundy
)

@Serializable
data class DownloadUrlResponse(
    val downloadUrl: String,
    val expiresIn: Int,
)

private val allowedPurposes = setOf("receipt", "invoice", "warranty", "avatar", "loyalty")
private val allowedContentTypes = setOf(
    "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/pdf"
)
private const val MAX_SIZE_BYTES = 20L * 1024 * 1024  // 20 MB

fun Route.storageRoutes(storage: StorageService) {
    authenticate("jwt") {
        route("/files") {

            /**
             * POST /api/v1/files/upload-url
             *
             * Server vydá presigned URL, na kterou klient PUTne soubor.
             * Klient pak pošle storageKey při uložení entity (receipt.photoKeys, invoice.fileKeys, ...).
             */
            post("/upload-url") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val req = call.receive<UploadUrlRequest>()

                if (req.purpose !in allowedPurposes) {
                    throw ApiException(HttpStatusCode.BadRequest, "invalid_purpose",
                        "Purpose musí být jeden z: ${allowedPurposes.joinToString()}")
                }
                if (req.contentType !in allowedContentTypes) {
                    throw ApiException(HttpStatusCode.BadRequest, "invalid_content_type",
                        "Povolené typy: ${allowedContentTypes.joinToString()}")
                }
                if (req.sizeBytes != null && req.sizeBytes > MAX_SIZE_BYTES) {
                    throw ApiException(HttpStatusCode.BadRequest, "file_too_large",
                        "Max velikost je ${MAX_SIZE_BYTES / 1024 / 1024} MB.")
                }

                val extension = req.contentType.substringAfter("/").replace("jpeg", "jpg")
                val storageKey = "$userId/${req.purpose}/${UUID.randomUUID()}.$extension"
                val url = storage.presignUpload(storageKey, req.contentType)

                db {
                    Files.insert {
                        it[ownerUserId] = userId
                        it[Files.storageKey] = storageKey
                        it[contentType] = req.contentType
                        it[sizeBytes] = req.sizeBytes
                        it[purpose] = req.purpose
                        it[createdAt] = Instant.now()
                    }
                }

                call.respond(UploadUrlResponse(
                    uploadUrl = url,
                    storageKey = storageKey,
                    expiresIn = 15 * 60,
                ))
            }

            /**
             * GET /api/v1/files/download-url?key=<storageKey>
             *
             * Vrátí presigned GET URL s platností 5 minut. Přístup mají:
             *   • uploader souboru (Files.ownerUserId)
             *   • vlastník/admin/group-member/per-profile-perm profilu, do kterého
             *     patří entita referencující soubor (receipt/invoice/warranty/loyalty)
             *   • ACCOUNTANT na profilu (read-only přístup k celému profilu)
             *   • per-account VIEWER/EDITOR (jen receipt/invoice fotky na sdíleném
             *     účtu, navíc projde visibility filter income/expense/categories)
             *
             * Před opravou (V32) endpoint odmítl všechny kromě uploadera, takže
             * accountant ani per-account share recipient neviděli fotky účtenek.
             */
            get("/download-url") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val storageKey = call.request.queryParameters["key"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_key", "Chybí parametr 'key'.")

                val canAccess = db {
                    val file = Files.selectAll()
                        .where { Files.storageKey eq storageKey }
                        .singleOrNull()
                        ?: return@db null
                    file to canAccessFile(userId, file)
                }
                if (canAccess == null) {
                    throw ApiException(HttpStatusCode.NotFound, "file_not_found", "Soubor nenalezen.")
                }
                val (_, allowed) = canAccess
                if (!allowed) {
                    throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Nemáš přístup k tomuto souboru.")
                }

                val url = storage.presignDownload(storageKey)
                call.respond(DownloadUrlResponse(downloadUrl = url, expiresIn = 5 * 60))
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Access control helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Hlavní rozhodovací logika pro download souboru. Implementuje stejný model
 * přístupů jako [cz.cointrack.sync.SyncService] — držet to v synchronizaci
 * je důležité, jinak by mohly nastat scénáře "user vidí entitu v sync, ale
 * nemůže si stáhnout její fotku" nebo opačně.
 */
private fun Transaction.canAccessFile(userId: UUID, fileRow: ResultRow): Boolean {
    // 1. Uploader = vždy přístup (vlastník souboru)
    if (fileRow[Files.ownerUserId].value == userId) return true

    val storageKey = fileRow[Files.storageKey]
    val purpose = fileRow[Files.purpose]

    // Avatar je čistě osobní — přístup má jen uploader (= sám user)
    if (purpose == "avatar") return false

    // 2. Profile-level full access (owner / org admin / group member / per-profile perm / accountant)
    val fullAccessProfileIds = (
        profilesAccessibleFully(userId) +
            accountantSharedProfileIds(userId)
        ).toSet()

    // 3. Per-account VIEWER/EDITOR shares (s visibility filtry)
    val perAccountShares = perAccountShareSpecs(userId)
    val sharedAccountIds = perAccountShares.map { it.accountId }.toSet()
    val specsByAccount = perAccountShares.associateBy { it.accountId }

    return when (purpose) {
        "receipt" -> hasReceiptFileAccess(storageKey, fullAccessProfileIds, sharedAccountIds, specsByAccount)
        "invoice" -> hasInvoiceFileAccess(storageKey, fullAccessProfileIds, sharedAccountIds)
        "warranty" -> hasWarrantyFileAccess(storageKey, fullAccessProfileIds)
        "loyalty" -> hasLoyaltyFileAccess(storageKey, fullAccessProfileIds)
        else -> false
    }
}

private fun Transaction.hasReceiptFileAccess(
    storageKey: String,
    fullAccessProfileIds: Set<UUID>,
    sharedAccountIds: Set<UUID>,
    specsByAccount: Map<UUID, FileShareSpec>,
): Boolean {
    // photoKeys je JSON array textem — hledáme "key" jako podřetězec.
    // Storage keys neobsahují % nebo _, takže LIKE wildcards nejsou problém.
    val pattern = "%\"$storageKey\"%"
    val matching = Receipts.selectAll()
        .where { (Receipts.photoKeys like pattern) and Receipts.deletedAt.isNull() }
        .toList()

    for (r in matching) {
        val profileId = r[Receipts.profileId].value
        if (profileId in fullAccessProfileIds) return true

        // Per-account share: receipt napojený na sdílený účet (přes linkedAccountId
        // pro CARD bez tx, nebo přes transactionId.accountId pro spárované)
        val linkedAcc = r[Receipts.linkedAccountId]?.value
        if (linkedAcc != null && linkedAcc in sharedAccountIds) {
            // Pro receipts s linkedAccountId bez tx není visibility filter aplikovatelný
            // (nemáme amount/type), tak povolujeme
            return true
        }
        val txId = r[Receipts.transactionId]?.value ?: continue
        val tx = Transactions.selectAll().where { Transactions.id eq txId }.singleOrNull() ?: continue
        val accId = tx[Transactions.accountId]?.value ?: continue
        if (accId !in sharedAccountIds) continue
        // Aplikuj visibility filter (income/expense + kategorie whitelist)
        val spec = specsByAccount[accId] ?: continue
        if (txPassesVisibility(tx, spec)) return true
    }
    return false
}

private fun Transaction.hasInvoiceFileAccess(
    storageKey: String,
    fullAccessProfileIds: Set<UUID>,
    sharedAccountIds: Set<UUID>,
): Boolean {
    val pattern = "%\"$storageKey\"%"
    val matching = Invoices.selectAll()
        .where { (Invoices.fileKeys like pattern) and Invoices.deletedAt.isNull() }
        .toList()
    for (i in matching) {
        val profileId = i[Invoices.profileId].value
        if (profileId in fullAccessProfileIds) return true
        // Per-account share: faktura napojena na sdílený účet
        val linkedAcc = i[Invoices.linkedAccountId]?.value
        if (linkedAcc != null && linkedAcc in sharedAccountIds) return true
        val txId = i[Invoices.linkedTransactionId]?.value ?: continue
        val tx = Transactions.selectAll().where { Transactions.id eq txId }.singleOrNull() ?: continue
        val accId = tx[Transactions.accountId]?.value ?: continue
        if (accId in sharedAccountIds) return true
    }
    return false
}

private fun Transaction.hasWarrantyFileAccess(
    storageKey: String,
    fullAccessProfileIds: Set<UUID>,
): Boolean {
    // Warranty: profile-scoped, jen full access
    val matching = Warranties.selectAll()
        .where { (Warranties.receiptImageKey eq storageKey) and Warranties.deletedAt.isNull() }
        .toList()
    return matching.any { it[Warranties.profileId].value in fullAccessProfileIds }
}

private fun Transaction.hasLoyaltyFileAccess(
    storageKey: String,
    fullAccessProfileIds: Set<UUID>,
): Boolean {
    val matching = LoyaltyCards.selectAll()
        .where {
            ((LoyaltyCards.frontImageKey eq storageKey) or (LoyaltyCards.backImageKey eq storageKey)) and
                LoyaltyCards.deletedAt.isNull()
        }
        .toList()
    return matching.any { it[LoyaltyCards.profileId].value in fullAccessProfileIds }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — užší kopie z SyncService.kt, jen co potřebujeme.
// ─────────────────────────────────────────────────────────────────────

private fun Transaction.profilesAccessibleFully(userId: UUID): List<UUID> {
    val adminOrgs = OrganizationMembers.selectAll()
        .where {
            (OrganizationMembers.userId eq userId) and
                (OrganizationMembers.role inList listOf("owner", "admin"))
        }
        .map { it[OrganizationMembers.organizationId].value }

    val allMemberOrgs = OrganizationMembers.selectAll()
        .where { OrganizationMembers.userId eq userId }
        .map { it[OrganizationMembers.organizationId].value }
    val groupOrgs = if (allMemberOrgs.isEmpty()) emptyList() else
        Organizations.selectAll()
            .where {
                (Organizations.id inList allMemberOrgs) and
                    (Organizations.type eq "GROUP") and
                    Organizations.deletedAt.isNull()
            }
            .map { it[Organizations.id].value }

    val accessibleOrgs = (adminOrgs + groupOrgs).distinct()

    val permProfiles = ProfilePermissions.selectAll()
        .where {
            (ProfilePermissions.userId eq userId) and
                (ProfilePermissions.permission inList listOf("view", "edit"))
        }
        .map { it[ProfilePermissions.profileId].value }

    return Profiles.selectAll()
        .where {
            var cond = (Profiles.ownerUserId eq userId)
            if (accessibleOrgs.isNotEmpty()) {
                cond = cond or (Profiles.organizationId inList accessibleOrgs)
            }
            if (permProfiles.isNotEmpty()) {
                cond = cond or (Profiles.id inList permProfiles)
            }
            cond and Profiles.deletedAt.isNull()
        }
        .map { it[Profiles.id].value }
}

private fun Transaction.accountantSharedProfileIds(userId: UUID): List<UUID> {
    val accountIds = AccountShares.selectAll()
        .where {
            (AccountShares.userId eq userId) and
                AccountShares.acceptedAt.isNotNull() and
                AccountShares.revokedAt.isNull() and
                (AccountShares.role eq "ACCOUNTANT")
        }
        .map { it[AccountShares.accountId].value }
    if (accountIds.isEmpty()) return emptyList()
    return Accounts.selectAll()
        .where { (Accounts.id inList accountIds) and Accounts.deletedAt.isNull() }
        .map { it[Accounts.profileId].value }
        .distinct()
}

private data class FileShareSpec(
    val accountId: UUID,
    val profileId: UUID,
    val visibilityIncome: Boolean,
    val visibilityExpenses: Boolean,
    val visibilityCategories: Set<String>?,
)

private fun Transaction.perAccountShareSpecs(userId: UUID): List<FileShareSpec> {
    return AccountShares.selectAll()
        .where {
            (AccountShares.userId eq userId) and
                AccountShares.acceptedAt.isNotNull() and
                AccountShares.revokedAt.isNull() and
                (AccountShares.role neq "ACCOUNTANT")
        }
        .mapNotNull { share ->
            val accountId = share[AccountShares.accountId].value
            val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                ?: return@mapNotNull null
            if (acc[Accounts.deletedAt] != null) return@mapNotNull null
            FileShareSpec(
                accountId = accountId,
                profileId = acc[Accounts.profileId].value,
                visibilityIncome = share[AccountShares.visibilityIncome],
                visibilityExpenses = share[AccountShares.visibilityExpenses],
                visibilityCategories = AccountShareService
                    .parseCategoryFilter(share[AccountShares.visibilityCategories])
                    ?.toSet(),
            )
        }
}

/**
 * Visibility filter pro transakci (income/expense + kategorie whitelist).
 * Stejná logika jako [SyncService.passesShareVisibility], ale bez
 * categoryIdToSync map — místo toho vrátí `false` pokud má spec whitelist
 * (= bezpečný default; pokud chce recipient i fotky txs s kategoriemi,
 * potřebuje mít visibility_categories=null).
 *
 * Pozn.: v ostře testovací konfiguraci by se musela mapnout categoryDbId
 * na syncId stejně jako v SyncService — pro fotku to ale není kritické,
 * protože visibility na fotku je jen sekundární filter (tx samotná je
 * filtrovaná na úrovni sync).
 */
private fun txPassesVisibility(txRow: ResultRow, spec: FileShareSpec): Boolean {
    val amount = txRow[Transactions.amount]
    val isTransfer = txRow[Transactions.isTransfer]
    val isIncome = amount.signum() > 0
    val passesType = when {
        isTransfer -> spec.visibilityIncome || spec.visibilityExpenses
        isIncome -> spec.visibilityIncome
        else -> spec.visibilityExpenses
    }
    if (!passesType) return false

    val catFilter = spec.visibilityCategories ?: return true  // null = bez filtru
    if (catFilter.isEmpty()) return false  // explicit "nic"
    val catId = txRow[Transactions.categoryId]?.value ?: return false
    // Pro file access kontrolujeme categoryId vs syncId. catId je DB UUID,
    // catFilter obsahuje syncIdy. Musíme dohledat syncId kategorie.
    // Pro jednoduchost: když je whitelist nastavený, vyžaduj že tx category
    // je v whitelistu. Načteme syncId kategorie:
    val cat = cz.cointrack.db.Categories.selectAll()
        .where { cz.cointrack.db.Categories.id eq catId }
        .singleOrNull() ?: return false
    val catSyncId = cat[cz.cointrack.db.Categories.syncId].toString()
    return catFilter.contains(catSyncId)
}
