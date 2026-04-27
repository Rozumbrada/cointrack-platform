package cz.cointrack.idoklad

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
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.util.UUID

fun Route.idokladRoutes(service: IDokladService) {
    authenticate("jwt") {
        route("/idoklad") {
            // Status pro daný profil
            get("/profiles/{profileId}/status") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                call.respond(service.status(userId, profileId))
            }

            // Uložení / aktualizace credentials
            put("/credentials") {
                val userId = call.userId()
                val req = call.receive<IDokladService.SaveCredentialsRequest>()
                service.saveCredentials(userId, req)
                call.respond(mapOf("ok" to true))
            }

            // Smazání credentials
            delete("/profiles/{profileId}/credentials") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                service.clearCredentials(userId, profileId)
                call.respond(mapOf("ok" to true))
            }

            // Ruční synchronizace
            post("/profiles/{profileId}/sync") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                val res = service.sync(userId, profileId)
                call.respond(res)
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
