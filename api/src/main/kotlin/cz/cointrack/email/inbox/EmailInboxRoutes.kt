package cz.cointrack.email.inbox

import cz.cointrack.db.Profiles
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.*
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

fun Route.emailInboxRoutes(service: EmailInboxService) {
    authenticate("jwt") {
        route("/email-inbox") {
            // List schránek pro aktivní profil (klient pošle profileSyncId v query)
            get("/accounts") {
                val userId = call.userId()
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile",
                        "Chybí profileSyncId v query.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                call.respond(service.listAccounts(profileDbId))
            }

            // Detail jedné
            get("/accounts/{id}") {
                val userId = call.userId()
                val accountId = call.pathUuid("id")
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí profileSyncId.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                call.respond(service.getAccount(accountId, profileDbId))
            }

            // Create
            post("/accounts") {
                val userId = call.userId()
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí profileSyncId.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                val req = call.receive<EmailInboxService.CreateAccountRequest>()
                call.respond(HttpStatusCode.Created, service.createAccount(profileDbId, req))
            }

            // Update
            patch("/accounts/{id}") {
                val userId = call.userId()
                val accountId = call.pathUuid("id")
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí profileSyncId.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                val req = call.receive<EmailInboxService.UpdateAccountRequest>()
                call.respond(service.updateAccount(accountId, profileDbId, req))
            }

            // Delete (soft)
            delete("/accounts/{id}") {
                val userId = call.userId()
                val accountId = call.pathUuid("id")
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí profileSyncId.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                service.deleteAccount(accountId, profileDbId)
                call.respond(mapOf("ok" to true))
            }

            // Manuální sync
            post("/accounts/{id}/sync") {
                val userId = call.userId()
                val accountId = call.pathUuid("id")
                val profileSyncId = call.request.queryParameters["profileSyncId"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí profileSyncId.")
                val profileDbId = resolveProfile(profileSyncId, userId)
                // Sanity: schránka patří profilu (uvnitř service je další check)
                service.getAccount(accountId, profileDbId)
                val result = service.syncAccount(accountId)
                call.respond(result)
            }

            // Test connection (před uložením)
            post("/test-connection") {
                call.userId() // jen auth check
                val req = call.receive<EmailInboxService.TestConnectionRequest>()
                call.respond(service.testConnection(req))
            }
        }
    }
}

private suspend fun resolveProfile(profileSyncId: String, userId: UUID): UUID = db {
    val syncId = runCatching { UUID.fromString(profileSyncId) }.getOrNull()
        ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_profile_sync_id", "Neplatné profileSyncId.")
    val profile = Profiles.selectAll().where { Profiles.syncId eq syncId }.singleOrNull()
        ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil neexistuje.")
    if (profile[Profiles.ownerUserId].value != userId) {
        // Pokud uživatel nevlastní profil, ale je v org/má perm, povol — to už řeší
        // sync layer. Pro email inbox vyžadujeme přímou ownership (citlivé credentials).
        throw ApiException(HttpStatusCode.Forbidden, "forbidden_profile",
            "Email schránku může spravovat jen vlastník profilu.")
    }
    profile[Profiles.id].value
}

private fun ApplicationCall.userId(): UUID {
    val p = principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    return UUID.fromString(p.subject)
}

private fun ApplicationCall.pathUuid(name: String): UUID {
    val raw = parameters[name]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí parametr $name.")
    return runCatching { UUID.fromString(raw) }
        .getOrElse { throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "Neplatné UUID: $raw") }
}
