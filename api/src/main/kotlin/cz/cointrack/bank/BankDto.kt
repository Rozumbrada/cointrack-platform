package cz.cointrack.bank

import kotlinx.serialization.Serializable

// ─── Request/response DTO pro /api/v1/bank/* ───────────────────────────

@Serializable
data class ConnectSessionRequest(
    /** Volitelný kód provideru (banky) pokud chce UI preselect. Jinak Salt Edge UI provider chooser. */
    val providerCode: String? = null,
    /**
     * Volitelný override language — "cs" | "en" | ... Defaultně "cs".
     */
    val locale: String = "cs",
)

@Serializable
data class ConnectSessionResponse(
    val connectUrl: String,
    val expiresAt: String,
)

@Serializable
data class BankConnectionDto(
    val id: String,                // naše UUID, ne Salt Edge ID
    val providerCode: String?,
    val providerName: String?,
    val status: String,            // active | inactive | disabled | error
    val lastSuccessAt: String?,
    val consentExpiresAt: String?,
    val lastError: String?,
    val accounts: List<BankAccountExtDto> = emptyList(),
)

@Serializable
data class BankAccountExtDto(
    val id: String,
    val name: String?,
    val nature: String?,
    val currencyCode: String,
    val iban: String?,
    val accountNumber: String?,
    val balance: String?,          // decimal jako string aby se neztratila přesnost
    val balanceUpdatedAt: String?,
)

@Serializable
data class BankTransactionExtDto(
    val id: String,
    val accountId: String,
    val amount: String,
    val currencyCode: String,
    val description: String?,
    val madeOn: String,
    val merchantName: String?,
    val status: String,
)

@Serializable
data class WebhookAck(val received: Boolean = true)

@Serializable
data class BankTransactionsResponse(
    val transactions: List<BankTransactionExtDto>,
)
