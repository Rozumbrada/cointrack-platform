package cz.cointrack.idoklad

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

/**
 * Tenký klient pro iDoklad API (https://api.idoklad.cz/Help).
 *
 * Autentizace: OAuth2 Client Credentials.
 *   POST https://identity.idoklad.cz/server/connect/token
 *   body: grant_type=client_credentials&client_id=…&client_secret=…&scope=idoklad_api
 *
 * Faktury:
 *   GET https://api.idoklad.cz/v3/IssuedInvoices    — vystavené (income)
 *   GET https://api.idoklad.cz/v3/ReceivedInvoices  — přijaté (expense)
 */
class IDokladClient {
    private val log = LoggerFactory.getLogger(IDokladClient::class.java)

    private val client = HttpClient(CIO) {
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 30_000
        }
        expectSuccess = false
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Serializable
    data class TokenResponse(
        val access_token: String,
        val token_type: String,
        val expires_in: Int,   // sekundy
    )

    /**
     * @return access token nebo throw [IDokladException] při HTTP chybě.
     */
    suspend fun obtainAccessToken(clientId: String, clientSecret: String): TokenResponse {
        val resp: HttpResponse = client.submitForm(
            url = "https://identity.idoklad.cz/server/connect/token",
            formParameters = Parameters.build {
                append("grant_type", "client_credentials")
                append("client_id", clientId)
                append("client_secret", clientSecret)
                append("scope", "idoklad_api")
            },
        )
        if (!resp.status.isSuccess()) {
            val body = resp.bodyAsText()
            log.warn("iDoklad token request failed: {} {}", resp.status, body.take(200))
            throw IDokladException("Token request failed: ${resp.status}", resp.status)
        }
        return json.decodeFromString(TokenResponse.serializer(), resp.bodyAsText())
    }

    /**
     * Stáhne stránku vystavených faktur.
     * Pohoda paging API: ?page=1&pagesize=50  (case-insensitive).
     */
    suspend fun listIssuedInvoices(
        accessToken: String,
        page: Int = 1,
        pageSize: Int = 100,
    ): IDokladInvoicePage {
        return getInvoicePage("IssuedInvoices", accessToken, page, pageSize)
    }

    suspend fun listReceivedInvoices(
        accessToken: String,
        page: Int = 1,
        pageSize: Int = 100,
    ): IDokladInvoicePage {
        return getInvoicePage("ReceivedInvoices", accessToken, page, pageSize)
    }

    private suspend fun getInvoicePage(
        path: String,
        accessToken: String,
        page: Int,
        pageSize: Int,
    ): IDokladInvoicePage {
        val resp = client.get("https://api.idoklad.cz/v3/$path") {
            bearerAuth(accessToken)
            parameter("page", page)
            parameter("pagesize", pageSize)
        }
        if (!resp.status.isSuccess()) {
            val body = resp.bodyAsText()
            log.warn("iDoklad GET {} failed: {} {}", path, resp.status, body.take(200))
            throw IDokladException("$path request failed: ${resp.status}", resp.status)
        }
        return json.decodeFromString(IDokladInvoicePage.serializer(), resp.bodyAsText())
    }

    @Serializable
    data class IDokladInvoicePage(
        val Data: List<IDokladInvoice>,
        val TotalItems: Int = 0,
        val TotalPages: Int = 1,
        val Page: Int = 1,
    )

    /**
     * iDoklad invoice — extrahované jen klíčová pole, která mapujeme na Cointrack Invoice.
     */
    @Serializable
    data class IDokladInvoice(
        val Id: Int,
        val DocumentNumber: String? = null,
        val DateOfIssue: String? = null,
        val DateOfMaturity: String? = null,
        val DateOfTaxing: String? = null,
        val Description: String? = null,
        val VariableSymbol: String? = null,
        val PartnerName: String? = null,
        val Note: String? = null,
        val IsPaid: Boolean = false,
        val PaymentStatus: String? = null,
        val Items: List<IDokladItem> = emptyList(),
        val Prices: IDokladPrices? = null,
        val CurrencyCode: String? = null,
    )

    @Serializable
    data class IDokladPrices(
        val TotalWithVat: Double = 0.0,
        val TotalWithoutVat: Double = 0.0,
    )

    @Serializable
    data class IDokladItem(
        val Name: String? = null,
        val Amount: Double = 1.0,
        val UnitPrice: Double = 0.0,
        val Price: Double = 0.0,
        val PriceWithVat: Double = 0.0,
        val VatRateType: String? = null,
    )
}

class IDokladException(message: String, val status: HttpStatusCode? = null) : RuntimeException(message)
