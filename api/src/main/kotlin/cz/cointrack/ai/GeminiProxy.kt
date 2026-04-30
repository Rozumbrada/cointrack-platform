package cz.cointrack.ai

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import org.slf4j.LoggerFactory
import java.util.UUID

data class GeminiConfig(
    val apiKey: String,
    val baseUrl: String,
    /** Pořadí fallback modelů — když primární vrátí 503 i po retries, server
     *  zkusí postupně tyto. Nejlepší je řadit od stejné generation k starší. */
    val fallbackModels: List<String> = listOf(
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
    ),
)

/**
 * Tenký HTTP proxy pro Gemini API.
 *
 * Bezpečnost: API klíč zůstává na serveru. Klient pošle JWT-autentizovaný request,
 * server přepošle obsah na Gemini s api klíčem v query stringu.
 *
 * Endpointy:
 *   POST /api/v1/ai/gemini/{model}  → forward to {baseUrl}/models/{model}:generateContent
 *
 * Body i response prochází 1:1 — server jen přidává `?key=...`.
 */
class GeminiProxyService(private val config: GeminiConfig) {
    private val log = LoggerFactory.getLogger(GeminiProxyService::class.java)

    private val client = HttpClient(CIO) {
        install(HttpTimeout) {
            requestTimeoutMillis = 60_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 60_000
        }
        expectSuccess = false
    }

    val isConfigured: Boolean get() = config.apiKey.isNotBlank()

    /**
     * Přepošle request na Gemini API s retry + fallback strategií.
     *
     *  1. Zkusí primární `model`.
     *  2. Při 503 / 429 / 5xx udělá až 3 retries s exponential backoff
     *     (1s, 3s, 6s — celkem max ~10s navíc).
     *  3. Pokud i po retries selhává, prochází `config.fallbackModels`
     *     (jeden pokus na každý) — typicky když Google vyloží jeden model
     *     z kapacity, ostatní fungují.
     *  4. Vrací první úspěšnou odpověď. Pokud nikdo neuspěl, vrací poslední
     *     odpověď (= 503/429 z poslední iterace).
     *
     *  4xx errors (400, 403, 404) **nikdy neretrieují** — tam pomoc retry
     *  nepomůže (chyba klienta / autorizace / model neexistuje).
     */
    suspend fun forwardGenerate(model: String, requestBody: String): Pair<HttpStatusCode, String> {
        if (!isConfigured) {
            return HttpStatusCode.ServiceUnavailable to
                """{"error":"gemini_not_configured","message":"AI služby nejsou na serveru nakonfigurované."}"""
        }
        val safeModel = model.replace("/", "").replace("..", "")

        // Pokud žadatel sám neposlal model z fallback listu, prepend ho na začátek.
        val modelChain = buildList {
            add(safeModel)
            for (fallback in config.fallbackModels) {
                if (fallback != safeModel) add(fallback)
            }
        }

        var lastStatus: HttpStatusCode = HttpStatusCode.ServiceUnavailable
        var lastBody = """{"error":"unknown","message":"No attempts made."}"""

        for ((modelIdx, currentModel) in modelChain.withIndex()) {
            // Pro primární model: 1 initial + 3 retries. Pro fallback: 1 attempt.
            val maxAttempts = if (modelIdx == 0) 4 else 1
            for (attempt in 1..maxAttempts) {
                val (status, body) = singleCall(currentModel, requestBody)
                lastStatus = status
                lastBody = body
                if (status.isSuccess()) {
                    if (modelIdx > 0 || attempt > 1) {
                        log.info(
                            "Gemini proxy success after retry/fallback (model={}, attempt={})",
                            currentModel, attempt,
                        )
                    }
                    return status to body
                }
                // 4xx errors: nesmysl retrieovat, pojď rovnou na další model nebo skonči
                if (status.value in 400..499 && status.value != 429) {
                    log.warn(
                        "Gemini proxy {} → {}: {} (4xx, no retry)",
                        currentModel, status.value, body.take(200),
                    )
                    break
                }
                // 5xx + 429: ještě je šance, exponential backoff (jen pokud máme další attempt)
                if (attempt < maxAttempts) {
                    val backoffMs = (1500L * attempt * attempt).coerceAtMost(6000L)
                    log.info(
                        "Gemini proxy {} → {} (attempt {}/{}), retrying in {}ms",
                        currentModel, status.value, attempt, maxAttempts, backoffMs,
                    )
                    kotlinx.coroutines.delay(backoffMs)
                }
            }
            // Tady jsme po vyčerpání pokusů na tomto modelu. Pokud existuje
            // další fallback, log + zkusíme ho.
            if (modelIdx < modelChain.lastIndex) {
                log.warn(
                    "Gemini proxy {} exhausted ({}); falling back to {}",
                    currentModel, lastStatus.value, modelChain[modelIdx + 1],
                )
            }
        }

        log.warn(
            "Gemini proxy all models exhausted, last {}: {}",
            lastStatus.value, lastBody.take(300),
        )
        return lastStatus to lastBody
    }

    /** Jeden POST na Gemini API, bez retry logiky. */
    private suspend fun singleCall(model: String, requestBody: String): Pair<HttpStatusCode, String> {
        val url = "${config.baseUrl}/models/$model:generateContent?key=${config.apiKey}"
        val resp: HttpResponse = client.post(url) {
            contentType(ContentType.Application.Json)
            headers { append(HttpHeaders.Accept, "application/json") }
            setBody(requestBody)
        }
        return resp.status to resp.bodyAsText()
    }
}

fun Route.geminiRoutes(service: GeminiProxyService) {
    authenticate("jwt") {
        route("/ai") {
            post("/gemini/{model}") {
                val userId = call.userIdOrThrow()
                val model = call.parameters["model"]
                    ?: return@post call.respond(
                        HttpStatusCode.BadRequest,
                        mapOf("error" to "missing_model"),
                    )
                val body = call.receiveText()
                val (status, response) = service.forwardGenerate(model, body)
                call.respondText(response, ContentType.Application.Json, status)
            }
        }
    }
}

private fun ApplicationCall.userIdOrThrow(): UUID {
    val principal = principal<JWTPrincipal>()
        ?: throw cz.cointrack.plugins.ApiException(
            HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.",
        )
    return UUID.fromString(principal.subject)
}
