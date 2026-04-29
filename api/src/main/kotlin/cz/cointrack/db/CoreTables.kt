package cz.cointrack.db

import org.jetbrains.exposed.dao.id.UUIDTable
import org.jetbrains.exposed.sql.Column
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.date
import org.jetbrains.exposed.sql.javatime.timestamp

/**
 * Core entity tables (V2 migration).
 *
 * Všechny entity sdílí sync pattern:
 * - sync_id (UUID, unique) — stabilní napříč zařízeními
 * - updated_at, deleted_at — soft delete + sync
 * - client_version — optimistic locking
 */

// ─── Mixin pro sync columns ────────────────────────────────────────
abstract class SyncableTable(name: String) : UUIDTable(name) {
    val syncId         = uuid("sync_id").uniqueIndex()
    val clientVersion  = long("client_version").default(1)
    val createdAt      = timestamp("created_at")
    val updatedAt      = timestamp("updated_at")
    val deletedAt      = timestamp("deleted_at").nullable()
}

// ─── Profiles ──────────────────────────────────────────────────────
object Profiles : SyncableTable("profiles") {
    val ownerUserId    = reference("owner_user_id", Users)
    val organizationId = reference("organization_id", Organizations).nullable()  // Sprint 5e — org profil
    val name           = varchar("name", 128)
    val type           = varchar("type", 16)
    val color          = integer("color").nullable()
    val businessFocus  = varchar("business_focus", 32).nullable()

    val ico            = varchar("ico", 16).nullable()
    val dic            = varchar("dic", 32).nullable()
    val companyName    = varchar("company_name", 256).nullable()
    val street         = varchar("street", 256).nullable()
    val zip            = varchar("zip", 16).nullable()
    val city           = varchar("city", 128).nullable()
    val phone          = varchar("phone", 64).nullable()
    val email          = varchar("email", 255).nullable()

    // ── iDoklad integration (V15) ──
    val idokladClientId         = varchar("idoklad_client_id", 128).nullable()
    /** AES-GCM ciphertext (base64); plaintext nikdy neopouští server. */
    val idokladClientSecretEnc  = text("idoklad_client_secret_enc").nullable()
    val idokladAccessToken      = text("idoklad_access_token").nullable()
    val idokladTokenExpiresAt   = timestamp("idoklad_token_expires_at").nullable()
    val idokladLastSyncAt       = timestamp("idoklad_last_sync_at").nullable()

    // ── Fio Bank integration (V26) ──
    /** AES-GCM ciphertext (base64) Fio API tokenu. Plain text nikdy nevynese server. */
    val fioTokenEnc             = text("fio_token_enc").nullable()
    val fioLastSyncAt           = timestamp("fio_last_sync_at").nullable()
    /** Posledně zpracovaný movement ID — Fio API "set-last-id" pro deduplikaci. */
    val fioLastMovementId       = long("fio_last_movement_id").nullable()
}

// ─── Accounts ──────────────────────────────────────────────────────
object Accounts : SyncableTable("accounts") {
    val profileId      = reference("profile_id", Profiles)
    val name           = varchar("name", 128)
    val type           = varchar("type", 32)
    val currency       = varchar("currency", 3).default("CZK")
    val initialBalance = decimal("initial_balance", 18, 2).default(java.math.BigDecimal.ZERO)
    val color          = integer("color").nullable()
    val icon           = varchar("icon", 64).nullable()
    val excludedFromTotal = bool("excluded_from_total").default(false)

    val bankProvider        = varchar("bank_provider", 32).nullable()
    val bankExternalId      = varchar("bank_external_id", 128).nullable()
    val bankIban            = varchar("bank_iban", 64).nullable()
    val bankAccountNumber   = varchar("bank_account_number", 32).nullable()
    val bankCode            = varchar("bank_code", 8).nullable()
    /** Pohoda Banky → Zkratka pro typ:ids při XML importu (max 19 znaků). */
    val pohodaShortcut      = varchar("pohoda_shortcut", 19).nullable()
}

// ─── Categories ────────────────────────────────────────────────────
object Categories : SyncableTable("categories") {
    val profileId      = reference("profile_id", Profiles)
    val name           = varchar("name", 128)
    val nameEn         = varchar("name_en", 128).nullable()
    val type           = varchar("type", 16)
    val color          = integer("color").nullable()
    val icon           = varchar("icon", 64).nullable()
    val position       = integer("position").default(0)
}

// ─── Transactions ──────────────────────────────────────────────────
object Transactions : SyncableTable("transactions") {
    val profileId      = reference("profile_id", Profiles)
    val accountId      = reference("account_id", Accounts).nullable()
    val categoryId     = reference("category_id", Categories).nullable()

    val amount         = decimal("amount", 18, 2)
    val currency       = varchar("currency", 3).default("CZK")
    val description    = text("description").nullable()
    val merchant       = varchar("merchant", 256).nullable()
    val date           = date("date")

    val bankTxId              = varchar("bank_tx_id", 128).nullable()
    val bankVs                = varchar("bank_vs", 32).nullable()
    val bankCs                = varchar("bank_cs", 32).nullable()
    val bankSs                = varchar("bank_ss", 32).nullable()
    val bankCounterparty      = varchar("bank_counterparty", 128).nullable()
    val bankCounterpartyName  = varchar("bank_counterparty_name", 256).nullable()

    val isTransfer     = bool("is_transfer").default(false)
    val transferPairId = uuid("transfer_pair_id").nullable()
}

// ─── Receipts ──────────────────────────────────────────────────────
object Receipts : SyncableTable("receipts") {
    val profileId       = reference("profile_id", Profiles)
    val categoryId      = reference("category_id", Categories).nullable()
    val transactionId   = reference("transaction_id", Transactions).nullable()

    val merchantName    = varchar("merchant_name", 256).nullable()
    val merchantIco     = varchar("merchant_ico", 16).nullable()
    val merchantDic     = varchar("merchant_dic", 32).nullable()
    val merchantStreet  = varchar("merchant_street", 256).nullable()
    val merchantCity    = varchar("merchant_city", 128).nullable()
    val merchantZip     = varchar("merchant_zip", 16).nullable()
    val date            = date("date")
    val time            = varchar("time", 8).nullable()
    val totalWithVat    = decimal("total_with_vat", 18, 2).default(java.math.BigDecimal.ZERO)
    val totalWithoutVat = decimal("total_without_vat", 18, 2).nullable()
    val currency        = varchar("currency", 3).default("CZK")
    val paymentMethod   = varchar("payment_method", 16).nullable()
    val note            = text("note").nullable()
    val photoKeys       = text("photo_keys").default("[]")  // JSONB jako text, aplikace parsuje
}

object ReceiptItems : SyncableTable("receipt_items") {
    val receiptId    = reference("receipt_id", Receipts)
    val name         = varchar("name", 256)
    val quantity     = decimal("quantity", 10, 3).default(java.math.BigDecimal.ONE)
    val unitPrice    = decimal("unit_price", 18, 2).nullable()
    val totalPrice   = decimal("total_price", 18, 2)
    val vatRate      = decimal("vat_rate", 5, 2).nullable()
    val position     = integer("position").default(0)
}

// ─── Invoices ──────────────────────────────────────────────────────
object Invoices : SyncableTable("invoices") {
    val profileId          = reference("profile_id", Profiles)
    val categoryId         = reference("category_id", Categories).nullable()
    val linkedAccountId    = reference("linked_account_id", Accounts).nullable()
    val linkedTransactionId = reference("linked_transaction_id", Transactions).nullable()

    val invoiceNumber      = varchar("invoice_number", 64).nullable()
    val isExpense          = bool("is_expense")
    val issueDate          = date("issue_date").nullable()
    val dueDate            = date("due_date").nullable()

    val totalWithVat       = decimal("total_with_vat", 18, 2).default(java.math.BigDecimal.ZERO)
    val totalWithoutVat    = decimal("total_without_vat", 18, 2).nullable()
    val currency           = varchar("currency", 3).default("CZK")

    val paymentMethod      = varchar("payment_method", 16).nullable()
    val variableSymbol     = varchar("variable_symbol", 32).nullable()
    val bankAccount        = varchar("bank_account", 64).nullable()
    val paid               = bool("paid").default(false)

    val supplierName       = varchar("supplier_name", 256).nullable()
    val supplierIco        = varchar("supplier_ico", 16).nullable()
    val supplierDic        = varchar("supplier_dic", 32).nullable()
    val supplierStreet     = varchar("supplier_street", 256).nullable()
    val supplierCity       = varchar("supplier_city", 128).nullable()
    val supplierZip        = varchar("supplier_zip", 16).nullable()

    val customerName       = varchar("customer_name", 256).nullable()

    val note               = text("note").nullable()
    val fileKeys           = text("file_keys").default("[]")
    val idokladId          = varchar("idoklad_id", 64).nullable()
}

object InvoiceItems : SyncableTable("invoice_items") {
    val invoiceId           = reference("invoice_id", Invoices)
    val name                = varchar("name", 256)
    val quantity            = decimal("quantity", 10, 3).default(java.math.BigDecimal.ONE)
    val unitPriceWithVat    = decimal("unit_price_with_vat", 18, 2).nullable()
    val totalPriceWithVat   = decimal("total_price_with_vat", 18, 2)
    val vatRate             = decimal("vat_rate", 5, 2).nullable()
    val position            = integer("position").default(0)
}

// ─── Loyalty cards ─────────────────────────────────────────────────
object LoyaltyCards : SyncableTable("loyalty_cards") {
    val profileId       = reference("profile_id", Profiles)
    val storeName       = varchar("store_name", 256)
    val cardNumber      = varchar("card_number", 256)
    val barcodeFormat   = varchar("barcode_format", 32).default("CODE_128")
    val color           = integer("color").nullable()
    val note            = text("note").default("")
    val logoUrl         = text("logo_url").nullable()
    val frontImageKey   = text("front_image_key").nullable()
    val backImageKey    = text("back_image_key").nullable()
}

// ─── Sprint 5c.5 entities ──────────────────────────────────────────

object Budgets : SyncableTable("budgets") {
    val profileId       = reference("profile_id", Profiles)
    val categoryId      = reference("category_id", Categories).nullable()
    val name            = varchar("name", 256)
    val limitAmount     = decimal("limit", 18, 2)   // "limit" je rezervované slovo — column name jinak
    val period          = varchar("period", 16).default("MONTHLY")
    val currency        = varchar("currency", 3).default("CZK")
}

object PlannedPayments : SyncableTable("planned_payments") {
    val profileId       = reference("profile_id", Profiles)
    val accountId       = reference("account_id", Accounts)
    val categoryId      = reference("category_id", Categories).nullable()
    val name            = varchar("name", 256)
    val amount          = decimal("amount", 18, 2)
    val currency        = varchar("currency", 3).default("CZK")
    val type            = varchar("type", 16).default("EXPENSE")
    val period          = varchar("period", 16).default("MONTHLY")
    val nextDate        = date("next_date")
    val note            = text("note").default("")
    val isActive        = bool("is_active").default(true)
}

object Debts : SyncableTable("debts") {
    val profileId       = reference("profile_id", Profiles)
    val personName      = varchar("person_name", 256)
    val amount          = decimal("amount", 18, 2)
    val currency        = varchar("currency", 3).default("CZK")
    val type            = varchar("type", 16).default("BORROWED")
    val description     = text("description").default("")
    val dueDate         = date("due_date").nullable()
    val isPaid          = bool("is_paid").default(false)
    val createdDate     = date("created_date")
}

object Goals : SyncableTable("goals") {
    val profileId       = reference("profile_id", Profiles)
    val name            = varchar("name", 256)
    val targetAmount    = decimal("target_amount", 18, 2)
    val currentAmount   = decimal("current_amount", 18, 2).default(java.math.BigDecimal.ZERO)
    val currency        = varchar("currency", 3).default("CZK")
    val color           = integer("color").nullable()
    val deadline        = date("deadline").nullable()
    val note            = text("note").default("")
}

object Warranties : SyncableTable("warranties") {
    val profileId        = reference("profile_id", Profiles)
    val productName      = varchar("product_name", 256)
    val shop             = varchar("shop", 256).default("")
    val purchaseDate     = date("purchase_date")
    val warrantyYears    = integer("warranty_years").default(2)
    val price            = decimal("price", 18, 2).nullable()
    val currency         = varchar("currency", 3).default("CZK")
    val note             = text("note").default("")
    val receiptImageKey  = text("receipt_image_key").nullable()
}

object ShoppingLists : SyncableTable("shopping_lists") {
    val profileId       = reference("profile_id", Profiles)
    val name            = varchar("name", 256)
    val color           = integer("color").default(0)
}

object ShoppingItems : SyncableTable("shopping_items") {
    val listId          = reference("list_id", ShoppingLists)
    val name            = varchar("name", 256)
    val quantity        = varchar("quantity", 32).default("1")
    val price           = decimal("price", 18, 2).nullable()
    val isChecked       = bool("is_checked").default(false)
}

object MerchantRules : SyncableTable("merchant_rules") {
    val profileId       = reference("profile_id", Profiles)
    val categoryId      = reference("category_id", Categories)
    val keyword         = varchar("keyword", 256)
    val createdAtStr    = text("created_at_str").default("")
}

object InvestmentPositions : SyncableTable("investment_positions") {
    val profileId       = reference("profile_id", Profiles)
    val accountId       = reference("account_id", Accounts)
    val symbol          = varchar("symbol", 32)
    val name            = varchar("name", 256)
    val quantity        = decimal("quantity", 18, 6)
    val buyPrice        = decimal("buy_price", 18, 4)
    val buyCurrency     = varchar("buy_currency", 8)
    val buyDate         = varchar("buy_date", 16)
    val platform        = varchar("platform", 64)
    val isOpen          = bool("is_open").default(true)
    val sellPrice       = decimal("sell_price", 18, 4).nullable()
    val sellDate        = varchar("sell_date", 16).nullable()
    val yahooSymbol     = varchar("yahoo_symbol", 32).nullable()
    val notes           = text("notes").nullable()
}

// ─── Group entities (Sprint 5g.2.d) ────────────────────────────────

object GroupMembers : SyncableTable("group_members") {
    val profileId        = reference("profile_id", Profiles)
    val name             = varchar("name", 128)
    val color            = integer("color").default(-13022129)
    /** null = guest, otherwise napojení na realný Cointrack ucet. */
    val cointrackUserId  = reference("cointrack_user_id", Users).nullable()
}

object GroupExpenses : SyncableTable("group_expenses") {
    val profileId                 = reference("profile_id", Profiles)
    val description               = varchar("description", 512)
    val amount                    = decimal("amount", 18, 2)
    val currency                  = varchar("currency", 3).default("CZK")
    /** sync_id platiciho clena — stabilni napric zarizeni. */
    val paidByMemberSyncId        = uuid("paid_by_member_sync_id")
    val defaultParticipantSyncIds = text("default_participant_sync_ids").default("[]")
    val date                      = date("date")
    val note                      = text("note").nullable()
    val isSettlement              = bool("is_settlement").default(false)
}

object GroupExpenseItems : SyncableTable("group_expense_items") {
    val expenseId           = reference("expense_id", GroupExpenses)
    val name                = varchar("name", 256)
    val amount              = decimal("amount", 18, 2)
    val participantSyncIds  = text("participant_sync_ids").default("[]")
    val position            = integer("position").default(0)
}

object FioAccounts : SyncableTable("fio_accounts") {
    val profileId       = reference("profile_id", Profiles)
    val name            = varchar("name", 256)
    val linkedAccountId = reference("linked_account_id", Accounts).nullable()
    val lastSync        = text("last_sync").nullable()
    val isEnabled       = bool("is_enabled").default(true)
    // token NE-synced
}

/**
 * V27: per-Fio-connection credentials. Backend-only storage (NEsynced přes
 * /sync), 1:1 mapping s mobilní [FioAccounts] přes [id] (= mobilní syncId).
 *
 * Token je AES-GCM šifrovaný (stejný klíč jako idoklad_client_secret_enc,
 * env IDOKLAD_ENC_KEY).
 */
object FioCredentials : org.jetbrains.exposed.dao.id.UUIDTable("fio_credentials") {
    val profileId       = reference("profile_id", Profiles)
    val name            = text("name")
    val tokenEnc        = text("token_enc")
    val accountIban     = text("account_iban").nullable()
    val lastSyncAt      = timestamp("last_sync_at").nullable()
    val lastMovementId  = long("last_movement_id").nullable()
    val createdAt       = timestamp("created_at")
    val updatedAt       = timestamp("updated_at")
    val deletedAt       = timestamp("deleted_at").nullable()
}

// ─── Files metadata ────────────────────────────────────────────────
object Files : UUIDTable("files") {
    val ownerUserId  = reference("owner_user_id", Users)
    val storageKey   = varchar("storage_key", 512).uniqueIndex()
    val contentType  = varchar("content_type", 128)
    val sizeBytes    = long("size_bytes").nullable()
    val purpose      = varchar("purpose", 32)
    val uploadedAt   = timestamp("uploaded_at").nullable()
    val createdAt    = timestamp("created_at")
}
