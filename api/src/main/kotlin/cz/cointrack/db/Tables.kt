package cz.cointrack.db

import org.jetbrains.exposed.dao.id.UUIDTable
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.timestamp

/**
 * Exposed definice tabulek. Musí odpovídat SQL migracím v `resources/db/migration/`.
 * Flyway vytváří tabulky, Exposed je používá pro typově bezpečné dotazy.
 */

object Users : UUIDTable("users") {
    val email            = varchar("email", 255).uniqueIndex()
    val emailVerifiedAt  = timestamp("email_verified_at").nullable()
    val passwordHash     = varchar("password_hash", 255).nullable()
    val displayName      = varchar("display_name", 128).nullable()
    val locale           = varchar("locale", 8).default("cs")
    val tier             = varchar("tier", 32).default("FREE")
    val tierExpiresAt    = timestamp("tier_expires_at").nullable()
    val createdAt        = timestamp("created_at")
    val updatedAt        = timestamp("updated_at")
    val deletedAt        = timestamp("deleted_at").nullable()
}

object OAuthAccounts : UUIDTable("oauth_accounts") {
    val userId           = reference("user_id", Users)
    val provider         = varchar("provider", 32)
    val providerUserId   = varchar("provider_user_id", 255)
    val createdAt        = timestamp("created_at")

    init {
        uniqueIndex(provider, providerUserId)
    }
}

object Sessions : UUIDTable("sessions") {
    val userId           = reference("user_id", Users)
    val tokenHash        = varchar("token_hash", 128).uniqueIndex()
    val userAgent        = text("user_agent").nullable()
    val ip               = text("ip").nullable()  // INET column, pracujeme jako text
    val expiresAt        = timestamp("expires_at")
    val createdAt        = timestamp("created_at")
    val lastUsedAt       = timestamp("last_used_at")
}

object RefreshTokens : UUIDTable("refresh_tokens") {
    val userId           = reference("user_id", Users)
    val tokenHash        = varchar("token_hash", 128).uniqueIndex()
    val deviceId         = varchar("device_id", 255).nullable()
    val expiresAt        = timestamp("expires_at")
    val revokedAt        = timestamp("revoked_at").nullable()
    val createdAt        = timestamp("created_at")
}

object EmailVerifications : UUIDTable("email_verifications") {
    val userId           = reference("user_id", Users)
    val tokenHash        = varchar("token_hash", 128).uniqueIndex()
    val expiresAt        = timestamp("expires_at")
    val usedAt           = timestamp("used_at").nullable()
    val createdAt        = timestamp("created_at")
}

object PasswordResets : UUIDTable("password_resets") {
    val userId           = reference("user_id", Users)
    val tokenHash        = varchar("token_hash", 128).uniqueIndex()
    val expiresAt        = timestamp("expires_at")
    val usedAt           = timestamp("used_at").nullable()
    val createdAt        = timestamp("created_at")
}

/** V17 — krátkodobé tokeny pro deep-link auto-login z mobilní apky na web. */
object MagicTokens : UUIDTable("magic_tokens") {
    val userId           = reference("user_id", Users)
    val tokenHash        = varchar("token_hash", 128).uniqueIndex()
    val nextPath         = varchar("next_path", 256).nullable()
    val createdAt        = timestamp("created_at")
    val expiresAt        = timestamp("expires_at")
    val usedAt           = timestamp("used_at").nullable()
}

object AuditLog : Table("audit_log") {
    val id               = long("id").autoIncrement()
    val userId           = uuid("user_id").nullable()
    val action           = varchar("action", 64)
    val metadata         = text("metadata")   // JSONB, serialized jako string
    val ip               = text("ip").nullable()
    val userAgent        = text("user_agent").nullable()
    val createdAt        = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// ─── Payments (V16) ───────────────────────────────────────────────
object Payments : org.jetbrains.exposed.dao.id.UUIDTable("payments") {
    val userId           = reference("user_id", Users)
    val tier             = varchar("tier", 16)             // PERSONAL/BUSINESS/ORGANIZATION
    val period           = varchar("period", 8)            // MONTHLY/YEARLY
    val amount           = decimal("amount", 10, 2)
    val currency         = varchar("currency", 3).default("CZK")
    val variableSymbol   = varchar("variable_symbol", 10).uniqueIndex()
    val iban             = varchar("iban", 64)
    val bankAccount      = varchar("bank_account", 40).nullable()
    val status           = varchar("status", 16).default("PENDING")
    val companyName      = varchar("company_name", 256).nullable()
    val companyIco       = varchar("company_ico", 16).nullable()
    val companyDic       = varchar("company_dic", 32).nullable()
    val companyAddress   = varchar("company_address", 512).nullable()
    val customerEmail    = varchar("customer_email", 255).nullable()
    val note             = text("note").nullable()
    val idokladInvoiceId = varchar("idoklad_invoice_id", 64).nullable()
    val invoicePdfKey    = varchar("invoice_pdf_key", 256).nullable()
    val createdAt        = timestamp("created_at")
    val expiresAt        = timestamp("expires_at")
    val paidAt           = timestamp("paid_at").nullable()
    val matchedTxId      = varchar("matched_tx_id", 64).nullable()
    val emailSentAt      = timestamp("email_sent_at").nullable()
}
