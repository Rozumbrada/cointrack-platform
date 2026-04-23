package cz.cointrack.sync

import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.time.Instant
import java.util.UUID

fun Route.syncRoutes(syncService: SyncService) {
    authenticate("jwt") {
        route("/sync") {

            /**
             * GET /api/v1/sync?since=2026-04-23T12:00:00Z
             *
             * Vrátí všechny entity uživatele, které byly upraveny po `since` timestampu.
             * Při prvním fetchu klient vynechá `since` — dostane vše.
             */
            get {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val since = call.request.queryParameters["since"]?.let { Instant.parse(it) }
                val result = syncService.pull(userId, since)
                call.respond(result)
            }

            /**
             * POST /api/v1/sync
             *
             * Klient pošle batch svých lokálních změn. Server je uloží / updatuje.
             * Při konfliktu (server má novější verzi) vrátí entity v `conflicts`.
             */
            post {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val req = call.receive<SyncPushRequest>()
                val result = syncService.push(userId, req)
                call.respond(result)
            }
        }
    }
}
