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
