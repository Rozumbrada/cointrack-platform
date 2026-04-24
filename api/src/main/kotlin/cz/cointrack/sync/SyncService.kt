package cz.cointrack.sync

import cz.cointrack.db.*
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.*
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.*
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Synchronizace mezi klienty a serverem.
 *
 * Klíčový design: klient pracuje výhradně se **sync_id** UUID, které se generují na klientovi
 * a zůstávají stabilní napříč zařízeními. Server ukládá sync_id + generuje vlastní db_id
 * (primární klíč). Při cross-entity reference (např. account.profileId) klient posílá sync_id
 * cílové entity, server ho překládá na db_id při zápisu a zpět při čtení.
 */
class SyncService {

    // ═══════════════════════════════════════════════════════════════════
    // PULL: GET /sync?since=ISO
    // ═══════════════════════════════════════════════════════════════════

    suspend fun pull(userId: UUID, since: Instant?): SyncPullResponse {
        val serverTime = Instant.now()
        val effectiveSince = since ?: Instant.EPOCH

        return db {
            val userProfileIds = Profiles.selectAll()
                .where { Profiles.ownerUserId eq userId }
                .map { it[Profiles.id].value }

            // Mapování db_id → sync_id pro každou referenční tabulku
            val profileIdToSync = Profiles.selectAll()
                .where { Profiles.id inList userProfileIds }
                .associate { it[Profiles.id].value to it[Profiles.syncId] }

            val accountIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                Accounts.selectAll()
                    .where { Accounts.profileId inList userProfileIds }
                    .associate { it[Accounts.id].value to it[Accounts.syncId] }

            val categoryIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                Categories.selectAll()
                    .where { Categories.profileId inList userProfileIds }
                    .associate { it[Categories.id].value to it[Categories.syncId] }

            val transactionIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                Transactions.selectAll()
                    .where { Transactions.profileId inList userProfileIds }
                    .associate { it[Transactions.id].value to it[Transactions.syncId] }

            val receiptIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                Receipts.selectAll()
                    .where { Receipts.profileId inList userProfileIds }
                    .associate { it[Receipts.id].value to it[Receipts.syncId] }

            val invoiceIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                Invoices.selectAll()
                    .where { Invoices.profileId inList userProfileIds }
                    .associate { it[Invoices.id].value to it[Invoices.syncId] }

            val result = mutableMapOf<String, List<SyncEntity>>()

            result["profiles"] = Profiles.selectAll()
                .where { (Profiles.ownerUserId eq userId) and (Profiles.updatedAt greater effectiveSince) }
                .map { profileToEntity(it) }

            result["accounts"] = if (userProfileIds.isEmpty()) emptyList() else
                Accounts.selectAll()
                    .where { (Accounts.profileId inList userProfileIds) and (Accounts.updatedAt greater effectiveSince) }
                    .map { accountToEntity(it, profileIdToSync) }

            result["categories"] = if (userProfileIds.isEmpty()) emptyList() else
                Categories.selectAll()
                    .where { (Categories.profileId inList userProfileIds) and (Categories.updatedAt greater effectiveSince) }
                    .map { categoryToEntity(it, profileIdToSync) }

            result["transactions"] = if (userProfileIds.isEmpty()) emptyList() else
                Transactions.selectAll()
                    .where { (Transactions.profileId inList userProfileIds) and (Transactions.updatedAt greater effectiveSince) }
                    .map { transactionToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }

            result["receipts"] = if (userProfileIds.isEmpty()) emptyList() else
                Receipts.selectAll()
                    .where { (Receipts.profileId inList userProfileIds) and (Receipts.updatedAt greater effectiveSince) }
                    .map { receiptToEntity(it, profileIdToSync, categoryIdToSync, transactionIdToSync) }

            result["invoices"] = if (userProfileIds.isEmpty()) emptyList() else
                Invoices.selectAll()
                    .where { (Invoices.profileId inList userProfileIds) and (Invoices.updatedAt greater effectiveSince) }
                    .map { invoiceToEntity(it, profileIdToSync, categoryIdToSync, accountIdToSync, transactionIdToSync) }

            result["receipt_items"] = if (userProfileIds.isEmpty()) emptyList() else
                (ReceiptItems innerJoin Receipts).selectAll()
                    .where { (Receipts.profileId inList userProfileIds) and (ReceiptItems.updatedAt greater effectiveSince) }
                    .map { receiptItemToEntity(it, receiptIdToSync) }

            result["invoice_items"] = if (userProfileIds.isEmpty()) emptyList() else
                (InvoiceItems innerJoin Invoices).selectAll()
                    .where { (Invoices.profileId inList userProfileIds) and (InvoiceItems.updatedAt greater effectiveSince) }
                    .map { invoiceItemToEntity(it, invoiceIdToSync) }

            result["loyalty_cards"] = if (userProfileIds.isEmpty()) emptyList() else
                LoyaltyCards.selectAll()
                    .where { (LoyaltyCards.profileId inList userProfileIds) and (LoyaltyCards.updatedAt greater effectiveSince) }
                    .map { loyaltyCardToEntity(it, profileIdToSync) }

            SyncPullResponse(serverTime.toString(), result)
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PUSH: POST /sync
    // ═══════════════════════════════════════════════════════════════════

    suspend fun push(userId: UUID, req: SyncPushRequest): SyncPushResponse = db {
        val accepted = mutableMapOf<String, MutableList<String>>()
        val conflicts = mutableMapOf<String, MutableList<SyncEntity>>()

        // Zpracuj entity v pořadí, v jakém se vyskytují v requestu
        // (očekáváme profiles → accounts/categories → transactions → receipts/invoices → items)
        for ((typeKey, entities) in req.entities) {
            val type = SyncEntityType.fromKey(typeKey) ?: continue
            for (entity in entities) {
                val result = upsertEntity(userId, type, entity)
                when (result) {
                    UpsertResult.Accepted -> accepted.getOrPut(typeKey) { mutableListOf() }.add(entity.syncId)
                    UpsertResult.Forbidden -> { /* ignoruj */ }
                    is UpsertResult.Conflict -> conflicts.getOrPut(typeKey) { mutableListOf() }.add(result.serverEntity)
                }
            }
        }

        SyncPushResponse(accepted, conflicts)
    }

    private sealed class UpsertResult {
        object Accepted : UpsertResult()
        object Forbidden : UpsertResult()
        data class Conflict(val serverEntity: SyncEntity) : UpsertResult()
    }

    private fun Transaction.upsertEntity(userId: UUID, type: SyncEntityType, e: SyncEntity): UpsertResult {
        val syncId = UUID.fromString(e.syncId)
        val updatedAt = Instant.parse(e.updatedAt)
        val deletedAt = e.deletedAt?.let { Instant.parse(it) }

        return when (type) {
            SyncEntityType.PROFILES      -> upsertProfile(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.ACCOUNTS      -> upsertAccount(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.CATEGORIES    -> upsertCategory(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.TRANSACTIONS  -> upsertTransaction(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.RECEIPTS      -> upsertReceipt(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.INVOICES      -> upsertInvoice(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.RECEIPT_ITEMS -> upsertReceiptItem(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.INVOICE_ITEMS -> upsertInvoiceItem(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.LOYALTY_CARDS -> upsertLoyaltyCard(userId, syncId, e, updatedAt, deletedAt)
        }
    }

    // ─── Helpers pro lookup / ownership check ──────────────────────────

    private fun Transaction.resolveProfileDbId(syncIdStr: String, userId: UUID): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        val row = Profiles.selectAll().where { Profiles.syncId eq syncId }.singleOrNull() ?: return null
        return if (row[Profiles.ownerUserId].value == userId) row[Profiles.id].value else null
    }

    private fun Transaction.resolveAccountDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Accounts.selectAll().where { Accounts.syncId eq syncId }.singleOrNull()?.get(Accounts.id)?.value
    }

    private fun Transaction.resolveCategoryDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Categories.selectAll().where { Categories.syncId eq syncId }.singleOrNull()?.get(Categories.id)?.value
    }

    private fun Transaction.resolveTransactionDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Transactions.selectAll().where { Transactions.syncId eq syncId }.singleOrNull()?.get(Transactions.id)?.value
    }

    private fun Transaction.resolveReceiptDbId(syncIdStr: String): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Receipts.selectAll().where { Receipts.syncId eq syncId }.singleOrNull()?.get(Receipts.id)?.value
    }

    private fun Transaction.resolveInvoiceDbId(syncIdStr: String): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Invoices.selectAll().where { Invoices.syncId eq syncId }.singleOrNull()?.get(Invoices.id)?.value
    }

    // ─── Profile upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertProfile(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val existing = Profiles.selectAll().where { Profiles.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[Profiles.ownerUserId].value != userId) return UpsertResult.Forbidden
            if (existing[Profiles.updatedAt] >= updatedAt) return UpsertResult.Conflict(profileToEntity(existing))
            Profiles.update({ Profiles.syncId eq syncId }) {
                applyProfileFields(it, e.data, e.clientVersion, updatedAt, deletedAt)
            }
        } else {
            Profiles.insert {
                it[Profiles.syncId] = syncId
                it[Profiles.ownerUserId] = userId
                it[Profiles.createdAt] = updatedAt
                applyProfileFields(it, e.data, e.clientVersion, updatedAt, deletedAt)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyProfileFields(
        s: UpdateBuilder<*>, d: JsonObject, clientVersion: Long, updatedAt: Instant, deletedAt: Instant?
    ) {
        s[Profiles.name] = d.str("name")
        s[Profiles.type] = d.str("type")
        s[Profiles.color] = d.intOrNull("color")
        s[Profiles.businessFocus] = d.strOrNull("businessFocus")
        s[Profiles.ico] = d.strOrNull("ico")
        s[Profiles.dic] = d.strOrNull("dic")
        s[Profiles.companyName] = d.strOrNull("companyName")
        s[Profiles.street] = d.strOrNull("street")
        s[Profiles.zip] = d.strOrNull("zip")
        s[Profiles.city] = d.strOrNull("city")
        s[Profiles.phone] = d.strOrNull("phone")
        s[Profiles.email] = d.strOrNull("email")
        s[Profiles.clientVersion] = clientVersion
        s[Profiles.updatedAt] = updatedAt
        s[Profiles.deletedAt] = deletedAt
    }

    // ─── Account upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertAccount(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Accounts.selectAll().where { Accounts.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Accounts.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[Accounts.profileId].value }.singleOrNull()?.get(Profiles.syncId)
                return UpsertResult.Conflict(accountToEntity(existing, mapOf(existing[Accounts.profileId].value to (profileSync ?: UUID.randomUUID()))))
            }
            Accounts.update({ Accounts.syncId eq syncId }) {
                applyAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            Accounts.insert {
                it[Accounts.syncId] = syncId
                it[Accounts.createdAt] = updatedAt
                applyAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyAccountFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[Accounts.profileId] = EntityID(profileDbId, Profiles)
        s[Accounts.name] = d.str("name")
        s[Accounts.type] = d.str("type")
        s[Accounts.currency] = d.strOr("currency", "CZK")
        s[Accounts.initialBalance] = d.decimalOr("initialBalance", BigDecimal.ZERO)
        s[Accounts.color] = d.intOrNull("color")
        s[Accounts.icon] = d.strOrNull("icon")
        s[Accounts.excludedFromTotal] = d.boolOr("excludedFromTotal", false)
        s[Accounts.bankProvider] = d.strOrNull("bankProvider")
        s[Accounts.bankIban] = d.strOrNull("bankIban")
        s[Accounts.clientVersion] = cv
        s[Accounts.updatedAt] = updatedAt
        s[Accounts.deletedAt] = deletedAt
    }

    // ─── Category upsert ────────────────────────────────────────────────

    private fun Transaction.upsertCategory(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Categories.selectAll().where { Categories.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Categories.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[Categories.profileId].value }.singleOrNull()?.get(Profiles.syncId)
                return UpsertResult.Conflict(categoryToEntity(existing, mapOf(existing[Categories.profileId].value to (profileSync ?: UUID.randomUUID()))))
            }
            Categories.update({ Categories.syncId eq syncId }) {
                applyCategoryFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            Categories.insert {
                it[Categories.syncId] = syncId
                it[Categories.createdAt] = updatedAt
                applyCategoryFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyCategoryFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[Categories.profileId] = EntityID(profileDbId, Profiles)
        s[Categories.name] = d.str("name")
        s[Categories.nameEn] = d.strOrNull("nameEn")
        s[Categories.type] = d.str("type")
        s[Categories.color] = d.intOrNull("color")
        s[Categories.icon] = d.strOrNull("icon")
        s[Categories.position] = d.intOr("position", 0)
        s[Categories.clientVersion] = cv
        s[Categories.updatedAt] = updatedAt
        s[Categories.deletedAt] = deletedAt
    }

    // ─── Transaction upsert ─────────────────────────────────────────────

    private fun Transaction.upsertTransaction(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val accountDbId = resolveAccountDbId(e.data.strOrNull("accountId"))
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val existing = Transactions.selectAll().where { Transactions.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Transactions.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(transactionToEntity(existing, emptyMap(), emptyMap(), emptyMap()))
            }
            Transactions.update({ Transactions.syncId eq syncId }) {
                applyTransactionFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, accountDbId, categoryDbId, isInsert = false)
            }
        } else {
            Transactions.insert {
                it[Transactions.syncId] = syncId
                it[Transactions.createdAt] = updatedAt
                applyTransactionFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, accountDbId, categoryDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyTransactionFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, accountDbId: UUID?, categoryDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Transactions.profileId] = EntityID(profileDbId, Profiles)
        s[Transactions.accountId] = accountDbId?.let { EntityID(it, Accounts) }
        s[Transactions.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Transactions.amount] = d.decimal("amount")
        s[Transactions.currency] = d.strOr("currency", "CZK")
        s[Transactions.description] = d.strOrNull("description")
        s[Transactions.merchant] = d.strOrNull("merchant")
        s[Transactions.date] = LocalDate.parse(d.str("date"))
        s[Transactions.bankTxId] = d.strOrNull("bankTxId")
        s[Transactions.bankVs] = d.strOrNull("bankVs")
        s[Transactions.bankCounterparty] = d.strOrNull("bankCounterparty")
        s[Transactions.bankCounterpartyName] = d.strOrNull("bankCounterpartyName")
        s[Transactions.isTransfer] = d.boolOr("isTransfer", false)
        s[Transactions.transferPairId] = d.uuidOrNull("transferPairId")
        s[Transactions.clientVersion] = cv
        s[Transactions.updatedAt] = updatedAt
        s[Transactions.deletedAt] = deletedAt
    }

    // ─── Receipt upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertReceipt(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val transactionDbId = resolveTransactionDbId(e.data.strOrNull("transactionId"))
        val existing = Receipts.selectAll().where { Receipts.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Receipts.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(receiptToEntity(existing, emptyMap(), emptyMap(), emptyMap()))
            }
            Receipts.update({ Receipts.syncId eq syncId }) {
                applyReceiptFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, transactionDbId, isInsert = false)
            }
        } else {
            Receipts.insert {
                it[Receipts.syncId] = syncId
                it[Receipts.createdAt] = updatedAt
                applyReceiptFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, transactionDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyReceiptFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, categoryDbId: UUID?, transactionDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Receipts.profileId] = EntityID(profileDbId, Profiles)
        s[Receipts.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Receipts.transactionId] = transactionDbId?.let { EntityID(it, Transactions) }
        s[Receipts.merchantName] = d.strOrNull("merchantName")
        s[Receipts.date] = LocalDate.parse(d.str("date"))
        s[Receipts.time] = d.strOrNull("time")
        s[Receipts.totalWithVat] = d.decimalOr("totalWithVat", BigDecimal.ZERO)
        s[Receipts.totalWithoutVat] = d.decimalOrNull("totalWithoutVat")
        s[Receipts.currency] = d.strOr("currency", "CZK")
        s[Receipts.paymentMethod] = d.strOrNull("paymentMethod")
        s[Receipts.note] = d.strOrNull("note")
        s[Receipts.photoKeys] = d["photoKeys"]?.toString() ?: "[]"
        s[Receipts.clientVersion] = cv
        s[Receipts.updatedAt] = updatedAt
        s[Receipts.deletedAt] = deletedAt
    }

    // ─── Invoice upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertInvoice(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val accountDbId = resolveAccountDbId(e.data.strOrNull("linkedAccountId"))
        val transactionDbId = resolveTransactionDbId(e.data.strOrNull("linkedTransactionId"))
        val existing = Invoices.selectAll().where { Invoices.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Invoices.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(invoiceToEntity(existing, emptyMap(), emptyMap(), emptyMap(), emptyMap()))
            }
            Invoices.update({ Invoices.syncId eq syncId }) {
                applyInvoiceFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, accountDbId, transactionDbId, isInsert = false)
            }
        } else {
            Invoices.insert {
                it[Invoices.syncId] = syncId
                it[Invoices.createdAt] = updatedAt
                applyInvoiceFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, accountDbId, transactionDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyInvoiceFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, categoryDbId: UUID?, accountDbId: UUID?, transactionDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Invoices.profileId] = EntityID(profileDbId, Profiles)
        s[Invoices.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Invoices.linkedAccountId] = accountDbId?.let { EntityID(it, Accounts) }
        s[Invoices.linkedTransactionId] = transactionDbId?.let { EntityID(it, Transactions) }
        s[Invoices.invoiceNumber] = d.strOrNull("invoiceNumber")
        s[Invoices.isExpense] = d.bool("isExpense")
        s[Invoices.issueDate] = d.strOrNull("issueDate")?.let { LocalDate.parse(it) }
        s[Invoices.dueDate] = d.strOrNull("dueDate")?.let { LocalDate.parse(it) }
        s[Invoices.totalWithVat] = d.decimalOr("totalWithVat", BigDecimal.ZERO)
        s[Invoices.totalWithoutVat] = d.decimalOrNull("totalWithoutVat")
        s[Invoices.currency] = d.strOr("currency", "CZK")
        s[Invoices.paymentMethod] = d.strOrNull("paymentMethod")
        s[Invoices.variableSymbol] = d.strOrNull("variableSymbol")
        s[Invoices.bankAccount] = d.strOrNull("bankAccount")
        s[Invoices.paid] = d.boolOr("paid", false)
        s[Invoices.supplierName] = d.strOrNull("supplierName")
        s[Invoices.supplierIco] = d.strOrNull("supplierIco")
        s[Invoices.supplierDic] = d.strOrNull("supplierDic")
        s[Invoices.customerName] = d.strOrNull("customerName")
        s[Invoices.note] = d.strOrNull("note")
        s[Invoices.fileKeys] = d["fileKeys"]?.toString() ?: "[]"
        s[Invoices.idokladId] = d.strOrNull("idokladId")
        s[Invoices.clientVersion] = cv
        s[Invoices.updatedAt] = updatedAt
        s[Invoices.deletedAt] = deletedAt
    }

    // ─── Receipt item upsert ────────────────────────────────────────────

    private fun Transaction.upsertReceiptItem(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val receiptDbId = resolveReceiptDbId(e.data.str("receiptId")) ?: return UpsertResult.Forbidden
        // Ověř ownership přes receipt.profile
        val receipt = Receipts.selectAll().where { Receipts.id eq receiptDbId }.singleOrNull() ?: return UpsertResult.Forbidden
        val profile = Profiles.selectAll().where { Profiles.id eq receipt[Receipts.profileId].value }.singleOrNull() ?: return UpsertResult.Forbidden
        if (profile[Profiles.ownerUserId].value != userId) return UpsertResult.Forbidden

        val existing = ReceiptItems.selectAll().where { ReceiptItems.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[ReceiptItems.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(receiptItemToEntity(existing, mapOf(receiptDbId to receipt[Receipts.syncId])))
            }
            ReceiptItems.update({ ReceiptItems.syncId eq syncId }) {
                applyReceiptItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, receiptDbId, isInsert = false)
            }
        } else {
            ReceiptItems.insert {
                it[ReceiptItems.syncId] = syncId
                it[ReceiptItems.createdAt] = updatedAt
                applyReceiptItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, receiptDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyReceiptItemFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        receiptDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[ReceiptItems.receiptId] = EntityID(receiptDbId, Receipts)
        s[ReceiptItems.name] = d.str("name")
        s[ReceiptItems.quantity] = d.decimalOr("quantity", BigDecimal.ONE)
        s[ReceiptItems.unitPrice] = d.decimalOrNull("unitPrice")
        s[ReceiptItems.totalPrice] = d.decimal("totalPrice")
        s[ReceiptItems.vatRate] = d.decimalOrNull("vatRate")
        s[ReceiptItems.position] = d.intOr("position", 0)
        s[ReceiptItems.clientVersion] = cv
        s[ReceiptItems.updatedAt] = updatedAt
        s[ReceiptItems.deletedAt] = deletedAt
    }

    // ─── Invoice item upsert ────────────────────────────────────────────

    private fun Transaction.upsertInvoiceItem(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val invoiceDbId = resolveInvoiceDbId(e.data.str("invoiceId")) ?: return UpsertResult.Forbidden
        val invoice = Invoices.selectAll().where { Invoices.id eq invoiceDbId }.singleOrNull() ?: return UpsertResult.Forbidden
        val profile = Profiles.selectAll().where { Profiles.id eq invoice[Invoices.profileId].value }.singleOrNull() ?: return UpsertResult.Forbidden
        if (profile[Profiles.ownerUserId].value != userId) return UpsertResult.Forbidden

        val existing = InvoiceItems.selectAll().where { InvoiceItems.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[InvoiceItems.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(invoiceItemToEntity(existing, mapOf(invoiceDbId to invoice[Invoices.syncId])))
            }
            InvoiceItems.update({ InvoiceItems.syncId eq syncId }) {
                applyInvoiceItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, invoiceDbId, isInsert = false)
            }
        } else {
            InvoiceItems.insert {
                it[InvoiceItems.syncId] = syncId
                it[InvoiceItems.createdAt] = updatedAt
                applyInvoiceItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, invoiceDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyInvoiceItemFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        invoiceDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[InvoiceItems.invoiceId] = EntityID(invoiceDbId, Invoices)
        s[InvoiceItems.name] = d.str("name")
        s[InvoiceItems.quantity] = d.decimalOr("quantity", BigDecimal.ONE)
        s[InvoiceItems.unitPriceWithVat] = d.decimalOrNull("unitPriceWithVat")
        s[InvoiceItems.totalPriceWithVat] = d.decimal("totalPriceWithVat")
        s[InvoiceItems.vatRate] = d.decimalOrNull("vatRate")
        s[InvoiceItems.position] = d.intOr("position", 0)
        s[InvoiceItems.clientVersion] = cv
        s[InvoiceItems.updatedAt] = updatedAt
        s[InvoiceItems.deletedAt] = deletedAt
    }

    // ─── Loyalty card upsert ────────────────────────────────────────────

    private fun Transaction.upsertLoyaltyCard(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = LoyaltyCards.selectAll().where { LoyaltyCards.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[LoyaltyCards.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[LoyaltyCards.profileId].value }
                    .singleOrNull()?.get(Profiles.syncId) ?: UUID.randomUUID()
                return UpsertResult.Conflict(loyaltyCardToEntity(existing, mapOf(existing[LoyaltyCards.profileId].value to profileSync)))
            }
            LoyaltyCards.update({ LoyaltyCards.syncId eq syncId }) {
                applyLoyaltyCardFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            LoyaltyCards.insert {
                it[LoyaltyCards.syncId] = syncId
                it[LoyaltyCards.createdAt] = updatedAt
                applyLoyaltyCardFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyLoyaltyCardFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[LoyaltyCards.profileId] = EntityID(profileDbId, Profiles)
        s[LoyaltyCards.storeName] = d.str("storeName")
        s[LoyaltyCards.cardNumber] = d.str("cardNumber")
        s[LoyaltyCards.barcodeFormat] = d.strOr("barcodeFormat", "CODE_128")
        s[LoyaltyCards.color] = d.intOrNull("color")
        s[LoyaltyCards.note] = d.strOr("note", "")
        s[LoyaltyCards.logoUrl] = d.strOrNull("logoUrl")
        s[LoyaltyCards.frontImageKey] = d.strOrNull("frontImageKey")
        s[LoyaltyCards.backImageKey] = d.strOrNull("backImageKey")
        s[LoyaltyCards.clientVersion] = cv
        s[LoyaltyCards.updatedAt] = updatedAt
        s[LoyaltyCards.deletedAt] = deletedAt
    }

    // ═══════════════════════════════════════════════════════════════════
    // Mappery: ResultRow -> SyncEntity (db_id → sync_id translation)
    // ═══════════════════════════════════════════════════════════════════

    private fun profileToEntity(r: ResultRow) = SyncEntity(
        syncId = r[Profiles.syncId].toString(),
        updatedAt = r[Profiles.updatedAt].toString(),
        deletedAt = r[Profiles.deletedAt]?.toString(),
        clientVersion = r[Profiles.clientVersion],
        data = buildJsonObject {
            put("name", r[Profiles.name])
            put("type", r[Profiles.type])
            r[Profiles.color]?.let { put("color", it) }
            r[Profiles.businessFocus]?.let { put("businessFocus", it) }
            r[Profiles.ico]?.let { put("ico", it) }
            r[Profiles.dic]?.let { put("dic", it) }
            r[Profiles.companyName]?.let { put("companyName", it) }
            r[Profiles.street]?.let { put("street", it) }
            r[Profiles.zip]?.let { put("zip", it) }
            r[Profiles.city]?.let { put("city", it) }
            r[Profiles.phone]?.let { put("phone", it) }
            r[Profiles.email]?.let { put("email", it) }
        },
    )

    private fun accountToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Accounts.syncId].toString(),
        updatedAt = r[Accounts.updatedAt].toString(),
        deletedAt = r[Accounts.deletedAt]?.toString(),
        clientVersion = r[Accounts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Accounts.profileId].value] ?: r[Accounts.profileId].value).toString())
            put("name", r[Accounts.name])
            put("type", r[Accounts.type])
            put("currency", r[Accounts.currency])
            put("initialBalance", r[Accounts.initialBalance].toPlainString())
            r[Accounts.color]?.let { put("color", it) }
            r[Accounts.icon]?.let { put("icon", it) }
            put("excludedFromTotal", r[Accounts.excludedFromTotal])
            r[Accounts.bankProvider]?.let { put("bankProvider", it) }
            r[Accounts.bankIban]?.let { put("bankIban", it) }
        },
    )

    private fun categoryToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Categories.syncId].toString(),
        updatedAt = r[Categories.updatedAt].toString(),
        deletedAt = r[Categories.deletedAt]?.toString(),
        clientVersion = r[Categories.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Categories.profileId].value] ?: r[Categories.profileId].value).toString())
            put("name", r[Categories.name])
            r[Categories.nameEn]?.let { put("nameEn", it) }
            put("type", r[Categories.type])
            r[Categories.color]?.let { put("color", it) }
            r[Categories.icon]?.let { put("icon", it) }
            put("position", r[Categories.position])
        },
    )

    private fun transactionToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        accountIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Transactions.syncId].toString(),
        updatedAt = r[Transactions.updatedAt].toString(),
        deletedAt = r[Transactions.deletedAt]?.toString(),
        clientVersion = r[Transactions.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Transactions.profileId].value] ?: r[Transactions.profileId].value).toString())
            r[Transactions.accountId]?.let {
                put("accountId", (accountIdToSync[it.value] ?: it.value).toString())
            }
            r[Transactions.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            put("amount", r[Transactions.amount].toPlainString())
            put("currency", r[Transactions.currency])
            r[Transactions.description]?.let { put("description", it) }
            r[Transactions.merchant]?.let { put("merchant", it) }
            put("date", r[Transactions.date].toString())
            r[Transactions.bankTxId]?.let { put("bankTxId", it) }
            r[Transactions.bankVs]?.let { put("bankVs", it) }
            r[Transactions.bankCounterparty]?.let { put("bankCounterparty", it) }
            r[Transactions.bankCounterpartyName]?.let { put("bankCounterpartyName", it) }
            put("isTransfer", r[Transactions.isTransfer])
            r[Transactions.transferPairId]?.let { put("transferPairId", it.toString()) }
        },
    )

    private fun receiptToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
        transactionIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Receipts.syncId].toString(),
        updatedAt = r[Receipts.updatedAt].toString(),
        deletedAt = r[Receipts.deletedAt]?.toString(),
        clientVersion = r[Receipts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Receipts.profileId].value] ?: r[Receipts.profileId].value).toString())
            r[Receipts.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            r[Receipts.transactionId]?.let {
                put("transactionId", (transactionIdToSync[it.value] ?: it.value).toString())
            }
            r[Receipts.merchantName]?.let { put("merchantName", it) }
            put("date", r[Receipts.date].toString())
            r[Receipts.time]?.let { put("time", it) }
            put("totalWithVat", r[Receipts.totalWithVat].toPlainString())
            r[Receipts.totalWithoutVat]?.let { put("totalWithoutVat", it.toPlainString()) }
            put("currency", r[Receipts.currency])
            r[Receipts.paymentMethod]?.let { put("paymentMethod", it) }
            r[Receipts.note]?.let { put("note", it) }
            put("photoKeys", Json.parseToJsonElement(r[Receipts.photoKeys]))
        },
    )

    private fun receiptItemToEntity(r: ResultRow, receiptIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[ReceiptItems.syncId].toString(),
        updatedAt = r[ReceiptItems.updatedAt].toString(),
        deletedAt = r[ReceiptItems.deletedAt]?.toString(),
        clientVersion = r[ReceiptItems.clientVersion],
        data = buildJsonObject {
            put("receiptId", (receiptIdToSync[r[ReceiptItems.receiptId].value] ?: r[ReceiptItems.receiptId].value).toString())
            put("name", r[ReceiptItems.name])
            put("quantity", r[ReceiptItems.quantity].toPlainString())
            r[ReceiptItems.unitPrice]?.let { put("unitPrice", it.toPlainString()) }
            put("totalPrice", r[ReceiptItems.totalPrice].toPlainString())
            r[ReceiptItems.vatRate]?.let { put("vatRate", it.toPlainString()) }
            put("position", r[ReceiptItems.position])
        },
    )

    private fun invoiceToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
        accountIdToSync: Map<UUID, UUID>,
        transactionIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Invoices.syncId].toString(),
        updatedAt = r[Invoices.updatedAt].toString(),
        deletedAt = r[Invoices.deletedAt]?.toString(),
        clientVersion = r[Invoices.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Invoices.profileId].value] ?: r[Invoices.profileId].value).toString())
            r[Invoices.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.linkedAccountId]?.let {
                put("linkedAccountId", (accountIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.linkedTransactionId]?.let {
                put("linkedTransactionId", (transactionIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.invoiceNumber]?.let { put("invoiceNumber", it) }
            put("isExpense", r[Invoices.isExpense])
            r[Invoices.issueDate]?.let { put("issueDate", it.toString()) }
            r[Invoices.dueDate]?.let { put("dueDate", it.toString()) }
            put("totalWithVat", r[Invoices.totalWithVat].toPlainString())
            r[Invoices.totalWithoutVat]?.let { put("totalWithoutVat", it.toPlainString()) }
            put("currency", r[Invoices.currency])
            r[Invoices.paymentMethod]?.let { put("paymentMethod", it) }
            r[Invoices.variableSymbol]?.let { put("variableSymbol", it) }
            r[Invoices.bankAccount]?.let { put("bankAccount", it) }
            put("paid", r[Invoices.paid])
            r[Invoices.supplierName]?.let { put("supplierName", it) }
            r[Invoices.supplierIco]?.let { put("supplierIco", it) }
            r[Invoices.supplierDic]?.let { put("supplierDic", it) }
            r[Invoices.customerName]?.let { put("customerName", it) }
            r[Invoices.note]?.let { put("note", it) }
            put("fileKeys", Json.parseToJsonElement(r[Invoices.fileKeys]))
            r[Invoices.idokladId]?.let { put("idokladId", it) }
        },
    )

    private fun invoiceItemToEntity(r: ResultRow, invoiceIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[InvoiceItems.syncId].toString(),
        updatedAt = r[InvoiceItems.updatedAt].toString(),
        deletedAt = r[InvoiceItems.deletedAt]?.toString(),
        clientVersion = r[InvoiceItems.clientVersion],
        data = buildJsonObject {
            put("invoiceId", (invoiceIdToSync[r[InvoiceItems.invoiceId].value] ?: r[InvoiceItems.invoiceId].value).toString())
            put("name", r[InvoiceItems.name])
            put("quantity", r[InvoiceItems.quantity].toPlainString())
            r[InvoiceItems.unitPriceWithVat]?.let { put("unitPriceWithVat", it.toPlainString()) }
            put("totalPriceWithVat", r[InvoiceItems.totalPriceWithVat].toPlainString())
            r[InvoiceItems.vatRate]?.let { put("vatRate", it.toPlainString()) }
            put("position", r[InvoiceItems.position])
        },
    )

    private fun loyaltyCardToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[LoyaltyCards.syncId].toString(),
        updatedAt = r[LoyaltyCards.updatedAt].toString(),
        deletedAt = r[LoyaltyCards.deletedAt]?.toString(),
        clientVersion = r[LoyaltyCards.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[LoyaltyCards.profileId].value] ?: r[LoyaltyCards.profileId].value).toString())
            put("storeName", r[LoyaltyCards.storeName])
            put("cardNumber", r[LoyaltyCards.cardNumber])
            put("barcodeFormat", r[LoyaltyCards.barcodeFormat])
            r[LoyaltyCards.color]?.let { put("color", it) }
            put("note", r[LoyaltyCards.note])
            r[LoyaltyCards.logoUrl]?.let { put("logoUrl", it) }
            r[LoyaltyCards.frontImageKey]?.let { put("frontImageKey", it) }
            r[LoyaltyCards.backImageKey]?.let { put("backImageKey", it) }
        },
    )
}

// ═══════════════════════════════════════════════════════════════════════
// JsonObject extension helpers
// ═══════════════════════════════════════════════════════════════════════

private fun JsonObject.str(key: String): String =
    get(key)?.jsonPrimitive?.contentOrNull
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí pole '$key' v entity.data.")

private fun JsonObject.strOrNull(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
private fun JsonObject.strOr(key: String, default: String): String = get(key)?.jsonPrimitive?.contentOrNull ?: default
private fun JsonObject.intOrNull(key: String): Int? = get(key)?.jsonPrimitive?.intOrNull
private fun JsonObject.intOr(key: String, default: Int): Int = get(key)?.jsonPrimitive?.intOrNull ?: default
private fun JsonObject.bool(key: String): Boolean = get(key)?.jsonPrimitive?.booleanOrNull
    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí bool '$key'.")
private fun JsonObject.boolOr(key: String, default: Boolean): Boolean = get(key)?.jsonPrimitive?.booleanOrNull ?: default
private fun JsonObject.uuidOrNull(key: String): UUID? = get(key)?.jsonPrimitive?.contentOrNull?.let { UUID.fromString(it) }
private fun JsonObject.decimal(key: String): BigDecimal =
    get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) }
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí decimal '$key'.")
private fun JsonObject.decimalOrNull(key: String): BigDecimal? = get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) }
private fun JsonObject.decimalOr(key: String, default: BigDecimal): BigDecimal =
    get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) } ?: default

typealias UpdateBuilder<T> = org.jetbrains.exposed.sql.statements.UpdateBuilder<T>
