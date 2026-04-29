package cz.cointrack.fio

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
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.util.UUID

/**
 * Fio Bank routes (V27 multi-credential).
 *
 * Endpointy:
 *  - GET    /fio/profiles/{profileId}/connections           — list všech (bez tokenů)
 *  - POST   /fio/profiles/{profileId}/connections           — vytvořit/upsert
 *  - PATCH  /fio/connections/{id}                           — update name/token
 *  - DELETE /fio/connections/{id}                           — smazat
 *  - POST   /fio/connections/{id}/sync                      — sync jedné
 *
 * Backward-compat (V26 endpointy):
 *  - GET    /fio/profiles/{profileId}/status                — aggregate
 *  - PUT    /fio/credentials                                — upsert první
 *  - DELETE /fio/profiles/{profileId}/credentials           — smaže VŠECHNY
 *  - POST   /fio/profiles/{profileId}/sync                  — sync VŠECHNY
 */
fun Route.fioRoutes(service: FioService) {
    authenticate("jwt") {
        route("/fio") {
            // ─── New API (multi-credential) ───────────────────────────────

            get("/profiles/{profileId}/connections") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                call.respond(service.listConnections(userId, profileId))
            }

            post("/profiles/{profileId}/connections") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                val req = call.receive<FioService.CreateConnectionRequest>()
                call.respond(service.createConnection(userId, profileId, req))
            }

            patch("/connections/{id}") {
                val userId = call.userId()
                val id = call.pathUuid("id")
                val req = call.receive<FioService.UpdateConnectionRequest>()
                call.respond(service.updateConnection(userId, id, req))
            }

            delete("/connections/{id}") {
                val userId = call.userId()
                val id = call.pathUuid("id")
                service.deleteConnection(userId, id)
                call.respond(mapOf("ok" to true))
            }

            post("/connections/{id}/sync") {
                val userId = call.userId()
                val id = call.pathUuid("id")
                call.respond(service.syncConnection(userId, id))
            }

            // ─── Backward-compat (V26 endpointy) ──────────────────────────

            get("/profiles/{profileId}/status") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                call.respond(service.aggregateStatus(userId, profileId))
            }

            put("/credentials") {
                val userId = call.userId()
                val req = call.receive<FioService.SaveCredentialsRequest>()
                service.saveCredentials(userId, req)
                call.respond(mapOf("ok" to true))
            }

            delete("/profiles/{profileId}/credentials") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                service.clearCredentials(userId, profileId)
                call.respond(mapOf("ok" to true))
            }

            post("/profiles/{profileId}/sync") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                call.respond(service.syncAllForProfile(userId, profileId))
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
