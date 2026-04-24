package cz.cointrack.db

import org.jetbrains.exposed.dao.id.UUIDTable
import org.jetbrains.exposed.sql.javatime.date
import org.jetbrains.exposed.sql.javatime.timestamp

/**
 * Banking tabulky (Sprint 6). Musí odpovídat V9.0__banking.sql.
 * JSONB pole ukládáme jako text (kotlinx.serialization v service vrstvě).
 */

object BankCustomers : UUIDTable("bank_customers") {
    val userId      = reference("user_id", Users)
    val provider    = varchar("provider", 32)
    val externalId  = varchar("external_id", 128)
    val createdAt   = timestamp("created_at")

    init {
        uniqueIndex(userId, provider)
    }
}

object BankConnections : UUIDTable("bank_connections") {
    val customerId        = reference("customer_id", BankCustomers)
    val provider          = varchar("provider", 32)
    val externalId        = varchar("external_id", 128)
    val providerCode      = varchar("provider_code", 128).nullable()
    val providerName      = varchar("provider_name", 256).nullable()
    val status            = varchar("status", 32)
    val lastSuccessAt     = timestamp("last_success_at").nullable()
    val consentExpiresAt  = timestamp("consent_expires_at").nullable()
    val lastError         = text("last_error").nullable()
    val createdAt         = timestamp("created_at")
    val updatedAt         = timestamp("updated_at")
    val deletedAt         = timestamp("deleted_at").nullable()

    init {
        uniqueIndex(provider, externalId)
    }
}

object BankAccountsExt : UUIDTable("bank_accounts_ext") {
    val connectionId      = reference("connection_id", BankConnections)
    val externalId        = varchar("external_id", 128)
    val name              = varchar("name", 256).nullable()
    val nature            = varchar("nature", 32).nullable()
    val currencyCode      = varchar("currency_code", 8)
    val iban              = varchar("iban", 34).nullable()
    val accountNumber     = varchar("account_number", 64).nullable()
    val balance           = decimal("balance", 18, 4).nullable()
    val balanceUpdatedAt  = timestamp("balance_updated_at").nullable()
    val raw               = text("raw").nullable()
    val createdAt         = timestamp("created_at")
    val updatedAt         = timestamp("updated_at")
    val deletedAt         = timestamp("deleted_at").nullable()

    init {
        uniqueIndex(connectionId, externalId)
    }
}

object BankTransactionsExt : UUIDTable("bank_transactions_ext") {
    val accountExtId   = reference("account_ext_id", BankAccountsExt)
    val externalId     = varchar("external_id", 128)
    val amount         = decimal("amount", 18, 4)
    val currencyCode   = varchar("currency_code", 8)
    val description    = text("description").nullable()
    val categoryHint   = varchar("category_hint", 64).nullable()
    val madeOn         = date("made_on")
    val merchantName   = varchar("merchant_name", 256).nullable()
    val extra          = text("extra").nullable()
    val status         = varchar("status", 32)
    val raw            = text("raw").nullable()
    val createdAt      = timestamp("created_at")

    init {
        uniqueIndex(accountExtId, externalId)
    }
}

object BankWebhookEvents : UUIDTable("bank_webhook_events") {
    val provider              = varchar("provider", 32)
    val eventType             = varchar("event_type", 64)
    val externalConnectionId  = varchar("external_connection_id", 128).nullable()
    val payload               = text("payload")
    val signature             = text("signature").nullable()
    val receivedAt            = timestamp("received_at")
    val processedAt           = timestamp("processed_at").nullable()
    val error                 = text("error").nullable()
}
