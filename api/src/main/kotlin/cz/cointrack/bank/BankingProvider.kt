package cz.cointrack.bank

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.time.Instant

/**
 * Abstraktní banking provider. Salt Edge, GoCardless a Enable Banking ho implementují.
 * Service vrstva nepoužívá nic provider-specific — mění se jen implementace.
 */
interface BankingProvider {

    /** Identifier provideru ("saltedge" | "gocardless" | ...). Zapisuje se do bank_customers.provider. */
    val id: String

    /** Vytvoří customer-a u provider-a. Vrací external customer_id. */
    suspend fun createCustomer(userId: String, email: String?): String

    /**
     * Vytvoří connect session (hosted UI). Vrací URL, kam se má klient přesměrovat
     * + kdy URL expiruje.
     */
    suspend fun createConnectSession(
        externalCustomerId: String,
        providerCode: String?,
        locale: String,
        returnUrl: String,
    ): ConnectSessionPayload

    /** Načte jeden connection (včetně statusu a consent_expires_at). */
    suspend fun fetchConnection(externalConnectionId: String): ConnectionPayload

    /** Načte všechny účty pod connection. */
    suspend fun fetchAccounts(externalConnectionId: String): List<AccountPayload>

    /**
     * Načte transakce pro účet. Pokud `fromId` je uvedeno, vrátí jen transakce po něm
     * (provider-specific — Salt Edge používá 'from_id' cursor).
     */
    suspend fun fetchTransactions(
        externalConnectionId: String,
        externalAccountId: String,
        fromId: String? = null,
    ): List<TransactionPayload>

    /** Smaže connection na straně provider-a. */
    suspend fun removeConnection(externalConnectionId: String)

    /**
     * Ověří podpis přicházejícího webhook eventu. Pokud provider podpisy nemá nebo
     * se nechce validovat (dev), vrátí true.
     */
    fun verifyWebhook(signature: String?, rawBody: String): Boolean
}

data class ConnectSessionPayload(val url: String, val expiresAt: Instant)

data class ConnectionPayload(
    val externalId: String,
    val providerCode: String?,
    val providerName: String?,
    val status: String,
    val lastSuccessAt: Instant?,
    val consentExpiresAt: Instant?,
    val lastError: String?,
    val raw: JsonElement,
)

data class AccountPayload(
    val externalId: String,
    val name: String?,
    val nature: String?,
    val currencyCode: String,
    val iban: String?,
    val accountNumber: String?,
    val balance: java.math.BigDecimal?,
    val balanceUpdatedAt: Instant?,
    val raw: JsonObject,
)

data class TransactionPayload(
    val externalId: String,
    val amount: java.math.BigDecimal,
    val currencyCode: String,
    val description: String?,
    val categoryHint: String?,
    val madeOn: java.time.LocalDate,
    val merchantName: String?,
    val status: String,
    val extra: JsonObject?,
    val raw: JsonObject,
)
