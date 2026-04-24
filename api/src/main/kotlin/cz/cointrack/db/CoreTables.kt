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

    val bankProvider   = varchar("bank_provider", 32).nullable()
    val bankExternalId = varchar("bank_external_id", 128).nullable()
    val bankIban       = varchar("bank_iban", 64).nullable()
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
