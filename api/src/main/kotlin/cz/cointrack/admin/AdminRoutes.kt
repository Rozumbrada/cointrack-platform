package cz.cointrack.admin

import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
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
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

fun Route.adminRoutes(service: AdminService) {
    authenticate("jwt") {
        route("/admin") {
            // Quick "am I admin" check pro web — bez payloadu, jen 200/403.
            get("/check") {
                requireAdmin(call, service)
                call.respond(mapOf("isAdmin" to true))
            }

            route("/users") {
                get {
                    requireAdmin(call, service)
                    val q = call.request.queryParameters["q"]
                    val limit = call.request.queryParameters["limit"]?.toIntOrNull()?.coerceIn(1, 500) ?: 100
                    val offset = call.request.queryParameters["offset"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0
                    call.respond(service.listUsers(q, limit, offset))
                }

                get("/{userId}") {
                    requireAdmin(call, service)
                    val id = call.pathUuid("userId")
                    call.respond(service.getUser(id))
                }

                patch("/{userId}") {
                    val callerEmail = requireAdmin(call, service)
                    val id = call.pathUuid("userId")
                    val req = call.receive<UpdateUserRequest>()
                    call.respond(service.updateUser(id, req, callerEmail))
                }

                delete("/{userId}") {
                    val callerEmail = requireAdmin(call, service)
                    val id = call.pathUuid("userId")
                    service.softDeleteUser(id, callerEmail)
                    call.respond(mapOf("ok" to true))
                }

                post("/{userId}/restore") {
                    requireAdmin(call, service)
                    val id = call.pathUuid("userId")
                    service.restoreUser(id)
                    call.respond(mapOf("ok" to true))
                }
            }
        }
    }
}

/**
 * Vrátí callerův e-mail (pro audit) nebo throws 403, pokud user není admin.
 */
private suspend fun requireAdmin(call: ApplicationCall, service: AdminService): String {
    val principal = call.principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    val userId = UUID.fromString(principal.subject)
    val email = db {
        Users.selectAll().where { Users.id eq userId }
            .singleOrNull()?.get(Users.email)
    } ?: throw ApiException(HttpStatusCode.Unauthorized, "user_not_found", "Uživatel neexistuje.")
    if (!service.isAdmin(email)) {
        throw ApiException(HttpStatusCode.Forbidden, "not_admin",
            "Tato sekce je dostupná jen administrátorům.")
    }
    return email
}

private fun ApplicationCall.pathUuid(name: String): UUID {
    val raw = parameters[name]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí parametr $name.")
    return runCatching { UUID.fromString(raw) }
        .getOrElse { throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "Neplatné UUID: $raw") }
}
