package cz.cointrack.bank

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

data class SaltEdgeConfig(
    val appId: String,
    val secret: String,
    val baseUrl: String,       // https://www.saltedge.com/api/v5
    val returnUrl: String,     // /bank/return na webu (consent redirect zpět)
    val callbackUrl: String,   // /api/v1/bank/webhook
)

/**
 * Salt Edge v5 klient (pending tier / sandbox).
 *
 * Pending tier používá jen hlavičky `App-id` + `Secret`. Production tier vyžaduje RSA
 * podepisování — implementace (`signRequest()`) je placeholder pro budoucí rozšíření.
 *
 * API reference: https://docs.saltedge.com/v5/
 */
class SaltEdgeProvider(private val config: SaltEdgeConfig) : BankingProvider {

    override val id: String = "saltedge"

    private val log = LoggerFactory.getLogger(SaltEdgeProvider::class.java)

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
    }

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) { json(this@SaltEdgeProvider.json) }
        install(Logging) {
            level = LogLevel.INFO
            logger = object : Logger {
                override fun log(message: String) {
                    this@SaltEdgeProvider.log.debug(message)
                }
            }
        }
        expectSuccess = false
        engine {
            requestTimeout = 30_000
        }
    }

    // ── BankingProvider impl ───────────────────────────────────────────

    override suspend fun createCustomer(userId: String, email: String?): String {
        val body = buildJsonObject {
            put("data", buildJsonObject {
                // Salt Edge vyžaduje unique string per customer; bereme náš user UUID.
                put("identifier", userId)
            })
        }
        // Idempotence: pokud Salt Edge vrátí 409 DuplicatedCustomer (customer už existuje
        // od předchozího pokusu), dohledej ho přes GET /customers?identifier=...
        // Poznámka: v6 používá pole `customer_id` (ne `id`).
        return try {
            val res = post("/customers", body)
            val data = res["data"] as? JsonObject ?: error("Chybí 'data' v odpovědi: $res")
            data["customer_id"]?.jsonPrimitive?.contentOrNull
                ?: data["id"]?.jsonPrimitive?.contentOrNull
                ?: error("Chybí customer_id ani id v odpovědi: $data")
        } catch (e: SaltEdgeException) {
            if (e.status == HttpStatusCode.Conflict) {
                log.info("Salt Edge customer $userId už existuje, dohledávám přes GET.")
                findCustomerByIdentifier(userId)
                    ?: throw IllegalStateException(
                        "Salt Edge vrátil 409 Conflict, ale GET /customers?identifier=$userId " +
                            "neobsahuje výsledek. Data nekonzistentní.", e
                    )
            } else throw e
        }
    }

    /**
     * Najde Salt Edge customer-a podle našeho identifier-u (user UUID).
     *
     * Salt Edge v6 ignoruje `?identifier=` query na `GET /customers` (vrací celý seznam).
     * Proto iterujeme přes stránky a hledáme lokálně. Limit 20 stránek = 2000 customers,
     * což pro jednu app-instanci stačí.
     */
    private suspend fun findCustomerByIdentifier(identifier: String): String? {
        var nextId: String? = null
        repeat(20) {
            val path = if (nextId != null) "/customers?from_id=$nextId" else "/customers"
            val res = get(path)
            val arr = res["data"] as? JsonArray ?: return null
            val sample = arr.take(3).joinToString(", ") { it.toString().take(200) }
            log.debug("Salt Edge GET $path → ${arr.size} customers, sample: $sample")

            val match = arr.filterIsInstance<JsonObject>()
                .firstOrNull { it["identifier"]?.jsonPrimitive?.contentOrNull == identifier }
            if (match != null) {
                // v6: customer_id; v5 starší: id (fallback)
                return match["customer_id"]?.jsonPrimitive?.contentOrNull
                    ?: match["id"]?.jsonPrimitive?.contentOrNull
            }

            val nextIdRaw = (res["meta"] as? JsonObject)?.get("next_id")?.jsonPrimitive
            nextId = nextIdRaw?.contentOrNull
            if (nextId == null) return null
        }
        log.warn("Salt Edge findCustomerByIdentifier $identifier: vyčerpáno 20 stránek bez nálezu.")
        return null
    }

    override suspend fun createConnectSession(
        externalCustomerId: String,
        providerCode: String?,
        locale: String,
        returnUrl: String,
    ): ConnectSessionPayload {
        // Salt Edge v6: endpoint /connections/connect (starý /connect_sessions/create je pryč),
        // consent scopes přejmenované na "accounts" / "transactions" / "holder_info".
        val body = buildJsonObject {
            put("data", buildJsonObject {
                put("customer_id", externalCustomerId)
                put("consent", buildJsonObject {
                    putJsonArray("scopes") {
                        add("accounts")
                        add("transactions")
                    }
                })
                put("attempt", buildJsonObject {
                    put("return_to", returnUrl)
                    put("locale", locale)
                    put("fetch_scopes", buildJsonArray {
                        add("accounts")
                        add("transactions")
                    })
                })
                // v6 defaultně blokuje connect stejných credentials pod jedním customer_id
                // ("DuplicatedCustomerCredentials"). Pro dev/test povolíme duplikáty,
                // ať nemusí user čistit dashboard ručně. V produkci zvážit vypnutí.
                put("allow_duplicates", true)
                if (providerCode != null) put("provider_code", providerCode)
            })
        }
        val res = post("/connections/connect", body)
        val url = requireString(res, "data.connect_url")
        val expiresStr = requireString(res, "data.expires_at")
        return ConnectSessionPayload(url = url, expiresAt = parseInstant(expiresStr))
    }

    override suspend fun fetchConnection(externalConnectionId: String): ConnectionPayload {
        val res = get("/connections/$externalConnectionId")
        val data = res["data"] as? JsonObject
            ?: error("Salt Edge odpověď bez 'data': $res")
        return ConnectionPayload(
            // v6: connection_id; fallback na id pro starší verze
            externalId = data["connection_id"]?.jsonPrimitive?.contentOrNull
                ?: data["id"]?.jsonPrimitive?.contentOrNull
                ?: externalConnectionId,
            providerCode = data["provider_code"]?.jsonPrimitive?.contentOrNull,
            providerName = data["provider_name"]?.jsonPrimitive?.contentOrNull,
            status = data["status"]?.jsonPrimitive?.contentOrNull ?: "unknown",
            lastSuccessAt = data["last_success_at"]?.jsonPrimitive?.contentOrNull?.let { parseInstant(it) },
            consentExpiresAt = data["next_refresh_possible_at"]?.jsonPrimitive?.contentOrNull?.let { parseInstant(it) },
            lastError = data["last_fail_error_class"]?.jsonPrimitive?.contentOrNull,
            raw = data,
        )
    }

    override suspend fun fetchAccounts(externalConnectionId: String): List<AccountPayload> {
        val res = get("/accounts?connection_id=$externalConnectionId")
        val arr = (res["data"] as? JsonArray) ?: return emptyList()
        return arr.filterIsInstance<JsonObject>().map { a ->
            val balance = a["balance"]?.jsonPrimitive?.doubleOrNull?.let { BigDecimal.valueOf(it) }
            AccountPayload(
                externalId = a["account_id"]?.jsonPrimitive?.contentOrNull
                    ?: a["id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                name = a["name"]?.jsonPrimitive?.contentOrNull,
                nature = a["nature"]?.jsonPrimitive?.contentOrNull,
                currencyCode = a["currency_code"]?.jsonPrimitive?.contentOrNull ?: "CZK",
                iban = (a["extra"] as? JsonObject)?.get("iban")?.jsonPrimitive?.contentOrNull,
                accountNumber = (a["extra"] as? JsonObject)?.get("account_number")?.jsonPrimitive?.contentOrNull,
                balance = balance,
                balanceUpdatedAt = (a["extra"] as? JsonObject)?.get("posted_at")?.jsonPrimitive?.contentOrNull?.let { parseInstant(it) },
                raw = a,
            )
        }
    }

    override suspend fun fetchTransactions(
        externalConnectionId: String,
        externalAccountId: String,
        fromId: String?,
    ): List<TransactionPayload> {
        val url = buildString {
            append("/transactions?connection_id=$externalConnectionId&account_id=$externalAccountId")
            if (fromId != null) append("&from_id=$fromId")
        }
        val res = get(url)
        val arr = (res["data"] as? JsonArray) ?: return emptyList()
        return arr.filterIsInstance<JsonObject>().map { t ->
            val amount = t["amount"]?.jsonPrimitive?.doubleOrNull?.let { BigDecimal.valueOf(it) }
                ?: BigDecimal.ZERO
            TransactionPayload(
                externalId = t["transaction_id"]?.jsonPrimitive?.contentOrNull
                    ?: t["id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                amount = amount,
                currencyCode = t["currency_code"]?.jsonPrimitive?.contentOrNull ?: "CZK",
                description = t["description"]?.jsonPrimitive?.contentOrNull,
                categoryHint = t["category"]?.jsonPrimitive?.contentOrNull,
                madeOn = LocalDate.parse(t["made_on"]?.jsonPrimitive?.contentOrNull ?: LocalDate.now().toString()),
                merchantName = (t["extra"] as? JsonObject)?.get("payee")?.jsonPrimitive?.contentOrNull,
                status = t["status"]?.jsonPrimitive?.contentOrNull ?: "posted",
                extra = t["extra"] as? JsonObject,
                raw = t,
            )
        }
    }

    override suspend fun removeConnection(externalConnectionId: String) {
        delete("/connections/$externalConnectionId")
    }

    override fun verifyWebhook(signature: String?, rawBody: String): Boolean {
        // TODO: Salt Edge posílá `Signature` header s RSA-SHA256. Pro pending tier
        //   (sandbox) je validace volitelná — zapneme v production. Teď přijímáme vše.
        return true
    }

    // ── HTTP jádro ─────────────────────────────────────────────────────

    private suspend fun get(path: String): JsonObject = request(HttpMethod.Get, path, null)
    private suspend fun post(path: String, body: JsonObject): JsonObject = request(HttpMethod.Post, path, body)
    private suspend fun delete(path: String): JsonObject = request(HttpMethod.Delete, path, null)

    private suspend fun request(method: HttpMethod, path: String, body: JsonObject?): JsonObject {
        val url = config.baseUrl.trimEnd('/') + path
        val resp: HttpResponse = client.request(url) {
            this.method = method
            headers {
                append("App-id", config.appId)
                append("Secret", config.secret)
                append("Accept", "application/json")
                if (body != null) append(HttpHeaders.ContentType, "application/json")
            }
            if (body != null) setBody(body.toString())
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) {
            log.warn("Salt Edge $method $path → ${resp.status}: $text")
            throw SaltEdgeException(resp.status, text)
        }
        return runCatching { json.parseToJsonElement(text).jsonObject }
            .getOrElse { error("Neplatná Salt Edge odpověď: $text") }
    }

    private fun parseInstant(s: String): Instant = try {
        Instant.parse(s)
    } catch (_: Exception) {
        // Salt Edge občas používá "YYYY-MM-DDTHH:mm:ssZ" nebo "YYYY-MM-DD HH:mm:ss UTC"
        val normalized = s.replace(" UTC", "Z").replace(' ', 'T')
        try { Instant.parse(normalized) } catch (_: Exception) {
            LocalDate.parse(s.take(10)).atStartOfDay().toInstant(ZoneOffset.UTC)
        }
    }

    private fun requireString(obj: JsonObject, path: String): String {
        val parts = path.split('.')
        var cur: JsonElement = obj
        for (p in parts) {
            cur = (cur as? JsonObject)?.get(p) ?: error("Chybí '$path' v odpovědi: $obj")
        }
        return (cur as? JsonPrimitive)?.contentOrNull ?: error("'$path' není string v odpovědi: $obj")
    }
}

class SaltEdgeException(val status: HttpStatusCode, body: String) :
    RuntimeException("Salt Edge $status: $body")
