package cz.cointrack.sharing

import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
data class AcceptShareRequest(val token: String)

fun Route.accountShareRoutes(service: AccountShareService) {
    route("/accounts") {
        // Public preview pro accept stránku (potřebuje jen token)
        get("/shares/preview") {
            val token = call.request.queryParameters["token"]
                ?: throw ApiException(HttpStatusCode.BadRequest, "missing_token", "Chybí token.")
            call.respond(service.previewInvite(token))
        }

        authenticate("jwt") {
            // Owner: pozve email ke sdílení
            post("/{accountId}/shares") {
                val userId = call.userId()
                val accountId = call.pathUuid("accountId")
                val req = call.receive<AccountShareService.InviteRequest>()
                call.respond(service.inviteEmail(accountId, userId, req))
            }

            // Owner: list pozvánek + aktivních sdílení pro účet
            get("/{accountId}/shares") {
                val userId = call.userId()
                val accountId = call.pathUuid("accountId")
                call.respond(service.listForAccount(accountId, userId))
            }

            // Owner: revoke share
            delete("/shares/{shareId}") {
                val userId = call.userId()
                val shareId = call.pathUuid("shareId")
                service.revoke(shareId, userId)
                call.respond(mapOf("ok" to true))
            }

            // Owner: úprava existujícího sdílení (role + visibility filtry)
            patch("/shares/{shareId}") {
                val userId = call.userId()
                val shareId = call.pathUuid("shareId")
                val req = call.receive<AccountShareService.UpdateShareRequest>()
                call.respond(service.updateShare(shareId, userId, req))
            }

            // Recipient: accept invite
            post("/shares/accept") {
                val userId = call.userId()
                val req = call.receive<AcceptShareRequest>()
                call.respond(service.acceptInvite(req.token, userId))
            }

            // Recipient: list všech share, které mám aktivně přijaté (pro UI)
            get("/shares/mine") {
                val userId = call.userId()
                call.respond(service.activeSharesForUser(userId))
            }

            // Owner: list všech share, které jsem vystavil napříč všemi mými účty
            get("/shares/owned") {
                val userId = call.userId()
                call.respond(service.listOwnedShares(userId))
            }
        }
    }
}

private fun io.ktor.server.application.ApplicationCall.userId(): UUID {
    val p = principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    return UUID.fromString(p.subject)
}

private fun io.ktor.server.application.ApplicationCall.pathUuid(name: String): UUID {
    val raw = parameters[name]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí parametr $name.")
    return runCatching { UUID.fromString(raw) }
        .getOrElse { throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "Neplatné UUID: $raw") }
}
