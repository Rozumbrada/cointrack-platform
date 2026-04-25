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
     * Přepošle request na Gemini API. Vrací (statusCode, body).
     */
    suspend fun forwardGenerate(model: String, requestBody: String): Pair<HttpStatusCode, String> {
        if (!isConfigured) {
            return HttpStatusCode.ServiceUnavailable to
                """{"error":"gemini_not_configured","message":"AI služby nejsou na serveru nakonfigurované."}"""
        }
        val safeModel = model.replace("/", "").replace("..", "")
        val url = "${config.baseUrl}/models/$safeModel:generateContent?key=${config.apiKey}"

        val resp: HttpResponse = client.post(url) {
            contentType(ContentType.Application.Json)
            headers {
                append(HttpHeaders.Accept, "application/json")
            }
            setBody(requestBody)
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) {
            log.warn("Gemini proxy {} → {}: {}", safeModel, resp.status.value, text.take(500))
        }
        return resp.status to text
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
