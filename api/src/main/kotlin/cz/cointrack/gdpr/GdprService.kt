package cz.cointrack.gdpr

import cz.cointrack.db.*
import cz.cointrack.plugins.ApiException
import cz.cointrack.storage.StorageService
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * GDPR služby — data export (článek 20 — právo na přenositelnost) a
 * smazání účtu (článek 17 — právo být zapomenut).
 *
 * - Export: JSON se všemi user-related daty + presigned URL pro soubory
 *   (TTL 7 dní, aby si je uživatel stihl stáhnout).
 * - Smazání: soft delete + 30 day grace period → background worker
 *   provede hard delete. Uživatel se může v této době přihlásit a
 *   smazání zrušit (cancel).
 */
class GdprService(
    private val storage: StorageService? = null,
) {
    private val log = LoggerFactory.getLogger(GdprService::class.java)
    private val json = Json { prettyPrint = true; encodeDefaults = false }

    @Serializable
    data class DeletionStatus(
        val requestedAt: String?,
        val deleteAfterAt: String?,
        val canCancel: Boolean,
    )

    /** Sestaví kompletní export user data jako JSON string. */
    suspend fun exportData(userId: UUID): String = db {
        val userRow = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "User nenalezen.")

        val profileRows = Profiles.selectAll().where { Profiles.ownerUserId eq userId }.toList()
        val profileIds = profileRows.map { it[Profiles.id].value }.toSet()

        val payload = buildJsonObject {
            put("exportedAt", JsonPrimitive(Instant.now().toString()))
            put("schemaVersion", JsonPrimitive(1))
            put("user", userToJson(userRow))
            put("profiles", JsonArray(profileRows.map(::profileToJson)))

            if (profileIds.isNotEmpty()) {
                put("accounts", queryByProfile(Accounts, Accounts.profileId, profileIds, ::accountToJson))
                put("categories", queryByProfile(Categories, Categories.profileId, profileIds, ::categoryToJson))
                put("transactions", queryByProfile(Transactions, Transactions.profileId, profileIds, ::transactionToJson))
                put("receipts", queryByProfile(Receipts, Receipts.profileId, profileIds, ::receiptToJson))
                put("invoices", queryByProfile(Invoices, Invoices.profileId, profileIds, ::invoiceToJson))
                put("loyaltyCards", queryByProfile(LoyaltyCards, LoyaltyCards.profileId, profileIds, ::loyaltyCardToJson))
                put("budgets", queryByProfile(Budgets, Budgets.profileId, profileIds, ::budgetToJson))
                put("plannedPayments", queryByProfile(PlannedPayments, PlannedPayments.profileId, profileIds, ::plannedPaymentToJson))
                put("debts", queryByProfile(Debts, Debts.profileId, profileIds, ::debtToJson))
                put("goals", queryByProfile(Goals, Goals.profileId, profileIds, ::goalToJson))
                put("warranties", queryByProfile(Warranties, Warranties.profileId, profileIds, ::warrantyToJson))
                put("shoppingLists", queryByProfile(ShoppingLists, ShoppingLists.profileId, profileIds, ::shoppingListToJson))
                put("merchantRules", queryByProfile(MerchantRules, MerchantRules.profileId, profileIds, ::merchantRuleToJson))
                put("investmentPositions", queryByProfile(InvestmentPositions, InvestmentPositions.profileId, profileIds, ::investmentPositionToJson))
            }

            // Files (přílohy) — metadata + 7-day presigned URLs
            val fileRows = Files.selectAll().where { Files.ownerUserId eq userId }.toList()
            put("files", JsonArray(fileRows.map(::fileToJson)))

            // Payments (platby/faktury za předplatné)
            val paymentRows = Payments.selectAll().where { Payments.userId eq userId }
                .orderBy(Payments.createdAt, SortOrder.DESC).toList()
            put("payments", JsonArray(paymentRows.map(::paymentToJson)))

            // Sessions — jen metadata (žádné token-hashe)
            val sessionRows = Sessions.selectAll().where { Sessions.userId eq userId }.toList()
            put("sessionsCount", JsonPrimitive(sessionRows.size))
        }

        json.encodeToString(JsonObject.serializer(), payload)
    }

    /** Označí účet jako deletion requested. Sessions/refresh tokens zneplatněny. */
    suspend fun requestDeletion(userId: UUID, graceDays: Long = 30): DeletionStatus = db {
        val userRow = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "User nenalezen.")

        if (userRow[Users.deletedAt] != null) {
            throw ApiException(HttpStatusCode.Conflict, "already_deleted", "Účet je již smazaný nebo čeká na smazání.")
        }

        val now = Instant.now()
        val deleteAfter = now.plus(graceDays, ChronoUnit.DAYS)

        Users.update({ Users.id eq userId }) {
            it[deletedAt] = now
            it[deleteRequestedAt] = now
            it[deleteAfterAt] = deleteAfter
            it[updatedAt] = now
        }

        // Zneplatnit všechny sessions + refresh tokens (revoke = expires_at = now)
        Sessions.update({ Sessions.userId eq userId }) {
            it[expiresAt] = now
        }
        RefreshTokens.update({ (RefreshTokens.userId eq userId) and (RefreshTokens.revokedAt.isNull()) }) {
            it[revokedAt] = now
        }

        log.info("GDPR deletion requested: userId=$userId, hardDeleteAt=$deleteAfter")

        DeletionStatus(
            requestedAt = now.toString(),
            deleteAfterAt = deleteAfter.toString(),
            canCancel = true,
        )
    }

    /** Status — kdy se účet smaže, jestli to lze ještě zrušit. */
    suspend fun deletionStatus(userId: UUID): DeletionStatus = db {
        val userRow = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "User nenalezen.")

        val requested = userRow[Users.deleteRequestedAt]
        val deleteAfter = userRow[Users.deleteAfterAt]
        DeletionStatus(
            requestedAt = requested?.toString(),
            deleteAfterAt = deleteAfter?.toString(),
            canCancel = requested != null && deleteAfter != null && deleteAfter.isAfter(Instant.now()),
        )
    }

    /** Cancel deletion — pokud je v grace period. */
    suspend fun cancelDeletion(userId: UUID) = db {
        val userRow = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "User nenalezen.")
        val deleteAfter = userRow[Users.deleteAfterAt]
            ?: throw ApiException(HttpStatusCode.BadRequest, "no_deletion", "Žádné čekající smazání.")
        if (deleteAfter.isBefore(Instant.now())) {
            throw ApiException(HttpStatusCode.Gone, "deletion_expired",
                "Grace period vypršela, účet už nelze obnovit.")
        }
        Users.update({ Users.id eq userId }) {
            it[deletedAt] = null
            it[deleteRequestedAt] = null
            it[deleteAfterAt] = null
            it[updatedAt] = Instant.now()
        }
        log.info("GDPR deletion cancelled: userId=$userId")
    }

    // ─── Row → JSON converters ─────────────────────────────────────────

    private fun userToJson(r: ResultRow) = buildJsonObject {
        put("id", JsonPrimitive(r[Users.id].value.toString()))
        put("email", JsonPrimitive(r[Users.email]))
        put("displayName", r[Users.displayName].toJson())
        put("locale", JsonPrimitive(r[Users.locale]))
        put("tier", JsonPrimitive(r[Users.tier]))
        put("tierExpiresAt", r[Users.tierExpiresAt]?.toString().toJson())
        put("emailVerifiedAt", r[Users.emailVerifiedAt]?.toString().toJson())
        put("createdAt", JsonPrimitive(r[Users.createdAt].toString()))
    }

    private fun profileToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Profiles.syncId].toString()))
        put("name", JsonPrimitive(r[Profiles.name]))
        put("type", JsonPrimitive(r[Profiles.type]))
        put("color", r[Profiles.color]?.let { JsonPrimitive(it) } ?: JsonNull)
        put("ico", r[Profiles.ico].toJson())
        put("dic", r[Profiles.dic].toJson())
        put("companyName", r[Profiles.companyName].toJson())
        put("street", r[Profiles.street].toJson())
        put("zip", r[Profiles.zip].toJson())
        put("city", r[Profiles.city].toJson())
        put("createdAt", JsonPrimitive(r[Profiles.createdAt].toString()))
    }

    private fun accountToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Accounts.syncId].toString()))
        put("profileSyncId", JsonPrimitive(profileSyncIdOf(r[Accounts.profileId].value)))
        put("name", JsonPrimitive(r[Accounts.name]))
        put("type", JsonPrimitive(r[Accounts.type]))
        put("currency", JsonPrimitive(r[Accounts.currency]))
        put("initialBalance", JsonPrimitive(r[Accounts.initialBalance].toPlainString()))
        put("bankIban", r[Accounts.bankIban].toJson())
        put("bankAccountNumber", r[Accounts.bankAccountNumber].toJson())
    }

    private fun categoryToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Categories.syncId].toString()))
        put("profileSyncId", JsonPrimitive(profileSyncIdOf(r[Categories.profileId].value)))
        put("name", JsonPrimitive(r[Categories.name]))
        put("type", JsonPrimitive(r[Categories.type]))
    }

    private fun transactionToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Transactions.syncId].toString()))
        put("profileSyncId", JsonPrimitive(profileSyncIdOf(r[Transactions.profileId].value)))
        put("amount", JsonPrimitive(r[Transactions.amount].toPlainString()))
        put("currency", JsonPrimitive(r[Transactions.currency]))
        put("date", JsonPrimitive(r[Transactions.date].toString()))
        put("description", r[Transactions.description].toJson())
        put("merchant", r[Transactions.merchant].toJson())
        put("bankVs", r[Transactions.bankVs].toJson())
    }

    private fun receiptToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Receipts.syncId].toString()))
        put("profileSyncId", JsonPrimitive(profileSyncIdOf(r[Receipts.profileId].value)))
        put("merchantName", r[Receipts.merchantName].toJson())
        put("date", JsonPrimitive(r[Receipts.date].toString()))
        put("totalWithVat", JsonPrimitive(r[Receipts.totalWithVat].toPlainString()))
        put("photoKeys", JsonPrimitive(r[Receipts.photoKeys]))
    }

    private fun invoiceToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Invoices.syncId].toString()))
        put("profileSyncId", JsonPrimitive(profileSyncIdOf(r[Invoices.profileId].value)))
        put("invoiceNumber", r[Invoices.invoiceNumber].toJson())
        put("isExpense", JsonPrimitive(r[Invoices.isExpense]))
        put("issueDate", r[Invoices.issueDate]?.toString().toJson())
        put("totalWithVat", JsonPrimitive(r[Invoices.totalWithVat].toPlainString()))
        put("paid", JsonPrimitive(r[Invoices.paid]))
        put("supplierName", r[Invoices.supplierName].toJson())
        put("customerName", r[Invoices.customerName].toJson())
    }

    private fun loyaltyCardToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[LoyaltyCards.syncId].toString()))
        put("storeName", JsonPrimitive(r[LoyaltyCards.storeName]))
        put("cardNumber", JsonPrimitive(r[LoyaltyCards.cardNumber]))
        put("barcodeFormat", JsonPrimitive(r[LoyaltyCards.barcodeFormat]))
    }

    private fun budgetToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Budgets.syncId].toString()))
        put("name", JsonPrimitive(r[Budgets.name]))
        put("limit", JsonPrimitive(r[Budgets.limitAmount].toPlainString()))
        put("period", JsonPrimitive(r[Budgets.period]))
    }

    private fun plannedPaymentToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[PlannedPayments.syncId].toString()))
        put("name", JsonPrimitive(r[PlannedPayments.name]))
        put("amount", JsonPrimitive(r[PlannedPayments.amount].toPlainString()))
        put("nextDate", JsonPrimitive(r[PlannedPayments.nextDate].toString()))
    }

    private fun debtToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Debts.syncId].toString()))
        put("personName", JsonPrimitive(r[Debts.personName]))
        put("amount", JsonPrimitive(r[Debts.amount].toPlainString()))
        put("type", JsonPrimitive(r[Debts.type]))
    }

    private fun goalToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Goals.syncId].toString()))
        put("name", JsonPrimitive(r[Goals.name]))
        put("targetAmount", JsonPrimitive(r[Goals.targetAmount].toPlainString()))
        put("currentAmount", JsonPrimitive(r[Goals.currentAmount].toPlainString()))
    }

    private fun warrantyToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[Warranties.syncId].toString()))
        put("productName", JsonPrimitive(r[Warranties.productName]))
        put("shop", JsonPrimitive(r[Warranties.shop]))
        put("purchaseDate", JsonPrimitive(r[Warranties.purchaseDate].toString()))
        put("warrantyYears", JsonPrimitive(r[Warranties.warrantyYears]))
    }

    private fun shoppingListToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[ShoppingLists.syncId].toString()))
        put("name", JsonPrimitive(r[ShoppingLists.name]))
    }

    private fun merchantRuleToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[MerchantRules.syncId].toString()))
        put("keyword", JsonPrimitive(r[MerchantRules.keyword]))
    }

    private fun investmentPositionToJson(r: ResultRow) = buildJsonObject {
        put("syncId", JsonPrimitive(r[InvestmentPositions.syncId].toString()))
        put("symbol", JsonPrimitive(r[InvestmentPositions.symbol]))
        put("name", JsonPrimitive(r[InvestmentPositions.name]))
        put("quantity", JsonPrimitive(r[InvestmentPositions.quantity].toPlainString()))
        put("buyPrice", JsonPrimitive(r[InvestmentPositions.buyPrice].toPlainString()))
        put("buyDate", JsonPrimitive(r[InvestmentPositions.buyDate]))
    }

    private fun fileToJson(r: ResultRow) = buildJsonObject {
        put("storageKey", JsonPrimitive(r[Files.storageKey]))
        put("contentType", JsonPrimitive(r[Files.contentType]))
        put("sizeBytes", r[Files.sizeBytes]?.let { JsonPrimitive(it) } ?: JsonNull)
        put("purpose", JsonPrimitive(r[Files.purpose]))
        put("uploadedAt", r[Files.uploadedAt]?.toString().toJson())
        // Presigned download URL platí 7 dní
        val url = runCatching {
            storage?.presignDownload(r[Files.storageKey], Duration.ofDays(7))
        }.getOrNull()
        put("downloadUrl", url.toJson())
    }

    private fun paymentToJson(r: ResultRow) = buildJsonObject {
        put("id", JsonPrimitive(r[Payments.id].value.toString()))
        put("tier", JsonPrimitive(r[Payments.tier]))
        put("period", JsonPrimitive(r[Payments.period]))
        put("amount", JsonPrimitive(r[Payments.amount].toPlainString()))
        put("currency", JsonPrimitive(r[Payments.currency]))
        put("status", JsonPrimitive(r[Payments.status]))
        put("variableSymbol", JsonPrimitive(r[Payments.variableSymbol]))
        put("invoiceNumber", r[Payments.invoiceNumber].toJson())
        put("createdAt", JsonPrimitive(r[Payments.createdAt].toString()))
        put("paidAt", r[Payments.paidAt]?.toString().toJson())
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    private val profileSyncIdCache = mutableMapOf<UUID, String>()
    private fun profileSyncIdOf(profileId: UUID): String = profileSyncIdCache.getOrPut(profileId) {
        Profiles.selectAll().where { Profiles.id eq profileId }.singleOrNull()
            ?.get(Profiles.syncId)?.toString() ?: profileId.toString()
    }

    private fun <T : Table> queryByProfile(
        table: T,
        profileCol: org.jetbrains.exposed.sql.Column<org.jetbrains.exposed.dao.id.EntityID<UUID>>,
        profileIds: Set<UUID>,
        mapper: (ResultRow) -> JsonObject,
    ): JsonArray {
        val rows = table.selectAll().where { profileCol inList profileIds }.toList()
        return JsonArray(rows.map(mapper))
    }

    private fun String?.toJson(): JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
}
