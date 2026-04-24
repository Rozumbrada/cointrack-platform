package cz.cointrack.bank

import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.util.UUID

fun Route.bankRoutes(service: BankService) {

    // ── Public webhook (žádná JWT auth, provider posílá server-to-server) ──
    route("/bank") {
        post("/webhook") {
            val signature = call.request.headers["Signature"]
            val body = call.receiveText()
            val ok = service.ingestWebhook(body, signature)
            if (ok) call.respond(WebhookAck(received = true))
            else call.respond(HttpStatusCode.BadRequest, WebhookAck(received = false))
        }
    }

    // ── Authenticated bank endpoints ─────────────────────────────────
    authenticate("jwt") {
        route("/bank") {

            // Spustí Salt Edge Connect — vrátí URL pro WebView
            post("/connect") {
                val userId = call.userId()
                val req = runCatching { call.receive<ConnectSessionRequest>() }
                    .getOrDefault(ConnectSessionRequest())
                call.respond(service.createConnectSession(userId, req))
            }

            // Seznam mých připojení + účtů
            get("/connections") {
                val userId = call.userId()
                call.respond(mapOf("connections" to service.listConnections(userId)))
            }

            // Smazání připojení
            delete("/connections/{id}") {
                val userId = call.userId()
                val id = call.pathUuid("id")
                service.deleteConnection(userId, id)
                call.respond(HttpStatusCode.NoContent)
            }

            // Manuální refresh (třeba když uživatel klikne "Aktualizovat")
            post("/connections/{id}/refresh") {
                call.userId()
                val localId = call.pathUuid("id")
                // Pro refresh potřebujeme external ID
                val extId = service.findExternalConnectionId(localId)
                service.refreshConnection(extId)
                call.respond(HttpStatusCode.Accepted, mapOf("status" to "refreshed"))
            }
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

private fun io.ktor.server.application.ApplicationCall.userId(): UUID {
    val principal = principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    return UUID.fromString(principal.subject)
}

private fun io.ktor.server.application.ApplicationCall.pathUuid(name: String): UUID {
    val raw = parameters[name]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí parametr $name.")
    return try {
        UUID.fromString(raw)
    } catch (_: IllegalArgumentException) {
        throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "Neplatné UUID: $raw")
    }
}
