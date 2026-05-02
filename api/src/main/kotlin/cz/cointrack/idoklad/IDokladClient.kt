package cz.cointrack.idoklad

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        // coerceInputValues: pokud iDoklad vrátí "Items": null místo "Items": [],
        // místo padání použij default hodnotu z data class (= emptyList()).
        // Stejně pro IsPaid: false default při null odpovědi.
        coerceInputValues = true
        // explicitNulls = false: nevyžaduje aby všechny nullable fieldy byly v JSONu
        // explicitně přítomné (i jako null) — chybějící klíč → null.
        explicitNulls = false
    }

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
        val body = resp.bodyAsText()
        if (!resp.status.isSuccess()) {
            log.warn("iDoklad GET {} failed: {} {}", path, resp.status, body.take(200))
            throw IDokladException("$path request failed: ${resp.status}", resp.status)
        }
        return try {
            json.decodeFromString(IDokladInvoicePage.serializer(), body)
        } catch (e: Exception) {
            // iDoklad mění schema — když nový field je non-nullable, deserializace
            // padne. Logujeme skutečnou chybu + sample odpovědi, ať to jde rychle
            // diagnostikovat (a ne "Unhandled exception" bez kontextu).
            log.error(
                "iDoklad GET {} response deserialization failed: {} | response sample: {}",
                path, e.message, body.take(500),
            )
            throw IDokladException(
                "iDoklad odpověď nelze zpracovat (možná nový field v API): ${e.message?.take(200)}",
                resp.status,
            )
        }
    }

    /**
     * Response wrapper iDoklad v3 list endpointů.
     *
     * Zjištěno empiricky 30. dubna 2026 (předtím jsme čekali plain array).
     * iDoklad API vrací: `{"Data": {"Items": [...], ...metadata}}` — `Data`
     * je vnořený objekt obsahující jak data tak pagination metadata.
     */
    @Serializable
    data class IDokladInvoicePage(
        val Data: IDokladInvoiceData = IDokladInvoiceData(),
    )

    /**
     * Vnitřní wrapper. iDoklad používá různé názvy paginace v různých endpointech;
     * čteme všechny tolerantně (default 0 / 1 pro chybějící). `fetchAllPages`
     * stejně iteruje dokud `Items.isEmpty()` — pagination meta jen pro telemetrii.
     */
    @Serializable
    data class IDokladInvoiceData(
        val Items: List<IDokladInvoice> = emptyList(),
        val TotalItemsCount: Int = 0,
        val TotalPagesCount: Int = 0,
        val PageNumber: Int = 0,
        val PageSize: Int = 0,
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

    // ─── Vytvoření vystavené faktury ──────────────────────────────────
    /**
     * Minimum-viable invoice creation. Uživatel může poslat jen základní pole;
     * iDoklad si dotáhne defaulty (dodavatel = aktuální firma, splatnost = 14 dní).
     *
     * Items.VatRateType: "Basic" (21%), "Reduced1" (15%), "Reduced2" (10%), "Zero" (0%).
     * Pro neplátce DPH dáváme "Zero".
     */
    @Serializable
    data class CreateInvoiceRequest(
        val PartnerName: String,
        val PartnerEmail: String? = null,
        val PartnerStreet: String? = null,
        val PartnerCity: String? = null,
        val PartnerPostalCode: String? = null,
        val PartnerIdentificationNumber: String? = null,
        val PartnerVatIdentificationNumber: String? = null,
        val DateOfIssue: String,           // YYYY-MM-DD
        val DateOfMaturity: String,        // YYYY-MM-DD
        val Description: String? = null,
        val Note: String? = null,
        val VariableSymbol: String? = null,
        val Items: List<CreateInvoiceItem>,
        val CurrencyCode: String = "CZK",
        val IsVatPayer: Boolean = false,   // false = neplátce DPH
    )

    @Serializable
    data class CreateInvoiceItem(
        val Name: String,
        val Amount: Double = 1.0,
        val UnitPrice: Double,
        val UnitName: String = "ks",
        val VatRateType: String = "Zero",
        val PriceType: String = "WithoutVat",  // pro neplátce DPH
    )

    suspend fun createInvoice(accessToken: String, req: CreateInvoiceRequest): IDokladInvoice {
        // iDoklad API očekává minimálně Partner.* placky a Items[]; pro neplátce DPH
        // stačí PriceType=WithoutVat + VatRateType=Zero.
        val body = buildInvoiceJson(req)
        val resp = client.post("https://api.idoklad.cz/v3/IssuedInvoices") {
            bearerAuth(accessToken)
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        if (!resp.status.isSuccess()) {
            val body = resp.bodyAsText()
            log.warn("iDoklad CreateInvoice failed: {} {}", resp.status, body.take(500))
            throw IDokladException("CreateInvoice failed: ${resp.status} — ${body.take(300)}", resp.status)
        }
        return json.decodeFromString(IDokladInvoice.serializer(), resp.bodyAsText())
    }

    /** iDoklad mark-paid = PUT /IssuedInvoices/{id} se změnou IsPaid + DateOfPayment. */
    suspend fun markInvoicePaid(accessToken: String, invoiceId: Int, dateOfPayment: String): IDokladInvoice {
        val body = buildJsonObject {
            put("Id", invoiceId)
            put("IsPaid", true)
            put("DateOfPayment", dateOfPayment)
        }.toString()
        val resp = client.put("https://api.idoklad.cz/v3/IssuedInvoices/$invoiceId") {
            bearerAuth(accessToken)
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        if (!resp.status.isSuccess()) {
            val txt = resp.bodyAsText()
            log.warn("iDoklad MarkPaid failed: {} {}", resp.status, txt.take(500))
            throw IDokladException("MarkPaid failed: ${resp.status} — ${txt.take(200)}", resp.status)
        }
        return json.decodeFromString(IDokladInvoice.serializer(), resp.bodyAsText())
    }

    /**
     * Stáhne PDF faktury jako ByteArray.
     *
     * iDoklad v3 endpoint `/IssuedInvoices/{Id}/GetPdf` vrací JSON ve tvaru
     *   { "Data": "<base64>", "FileName": "..." }
     * Ne raw bytes! Předtím jsme nesprávně používali `/Pdf` (404) → web
     * dostal HTTP error, mobile používal v2 endpoint který vracel JSON →
     * uložené ".pdf" obsahovalo JSON text → nešlo otevřít.
     *
     * Teď: parsujeme JSON, extrahujeme `Data`, dekódujeme base64 a vracíme
     * skutečné PDF bytes.
     */
    suspend fun getInvoicePdf(accessToken: String, invoiceId: Int): ByteArray {
        val resp = client.get("https://api.idoklad.cz/v3/IssuedInvoices/$invoiceId/GetPdf") {
            bearerAuth(accessToken)
        }
        if (!resp.status.isSuccess()) {
            val txt = resp.bodyAsText()
            log.warn("iDoklad PDF failed: {} {}", resp.status, txt.take(200))
            throw IDokladException("Get PDF failed: ${resp.status} — ${txt.take(200)}", resp.status)
        }
        val body = resp.bodyAsText()
        val parsed = runCatching { Json.parseToJsonElement(body) }.getOrNull()
            ?: throw IDokladException("PDF response není JSON: ${body.take(200)}", null)
        val dataField = parsed as? kotlinx.serialization.json.JsonObject
        val base64 = dataField?.get("Data")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            ?: dataField?.get("data")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            ?: throw IDokladException("PDF JSON chybí pole 'Data': ${body.take(200)}", null)
        return runCatching { java.util.Base64.getDecoder().decode(base64) }.getOrElse {
            throw IDokladException("PDF base64 decode selhal: ${it.message}", null)
        }
    }

    /** Pošle fakturu emailem zákazníkovi (přes iDoklad). */
    suspend fun sendInvoiceMail(accessToken: String, invoiceId: Int, to: String? = null) {
        val body = buildJsonObject {
            put("DocumentId", invoiceId)
            if (to != null) put("EmailTo", to)
        }.toString()
        val resp = client.post("https://api.idoklad.cz/v3/Mails/IssuedInvoice") {
            bearerAuth(accessToken)
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        if (!resp.status.isSuccess()) {
            val txt = resp.bodyAsText()
            log.warn("iDoklad SendMail failed: {} {}", resp.status, txt.take(500))
            throw IDokladException("Send mail failed: ${resp.status} — ${txt.take(200)}", resp.status)
        }
    }

    private fun buildInvoiceJson(req: CreateInvoiceRequest): String {
        // Sestavíme přes JsonObject — iDoklad má spoustu volitelných polí, takže si vystačíme s ručním buildem.
        val items = req.Items.map {
            buildJsonObject {
                put("Name", it.Name)
                put("Amount", it.Amount)
                put("UnitPrice", it.UnitPrice)
                put("UnitName", it.UnitName)
                put("VatRateType", it.VatRateType)
                put("PriceType", it.PriceType)
            }
        }
        val obj = buildJsonObject {
            put("PartnerContact", buildJsonObject {
                put("CompanyName", req.PartnerName)
                req.PartnerEmail?.let { put("Email", it) }
                req.PartnerStreet?.let { put("Street", it) }
                req.PartnerCity?.let { put("City", it) }
                req.PartnerPostalCode?.let { put("PostalCode", it) }
                req.PartnerIdentificationNumber?.let { put("IdentificationNumber", it) }
                req.PartnerVatIdentificationNumber?.let { put("VatIdentificationNumber", it) }
            })
            put("DateOfIssue", req.DateOfIssue)
            put("DateOfMaturity", req.DateOfMaturity)
            req.Description?.let { put("Description", it) }
            req.Note?.let { put("Note", it) }
            req.VariableSymbol?.let { put("VariableSymbol", it) }
            put("CurrencyId", currencyId(req.CurrencyCode))
            put("IsVatPayer", req.IsVatPayer)
            put("Items", kotlinx.serialization.json.JsonArray(items))
        }
        return obj.toString()
    }

    private fun currencyId(code: String): Int = when (code.uppercase()) {
        "CZK" -> 1
        "EUR" -> 2
        "USD" -> 3
        else -> 1
    }
}

class IDokladException(message: String, val status: HttpStatusCode? = null) : RuntimeException(message)
