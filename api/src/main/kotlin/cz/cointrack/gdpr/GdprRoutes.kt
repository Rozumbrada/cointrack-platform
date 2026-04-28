package cz.cointrack.gdpr

import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.util.UUID

@Serializable
data class DeletionStatusDto(
    val requestedAt: String? = null,
    val deleteAfterAt: String? = null,
    val canCancel: Boolean = false,
)

fun Route.gdprRoutes(gdpr: GdprService) {
    authenticate("jwt") {
        route("/gdpr") {

            /** GDPR čl. 20 — export uživatelských dat jako JSON. */
            get("/export") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val payload = gdpr.exportData(userId)
                val date = LocalDate.now().toString()
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """attachment; filename="cointrack-export-$date.json""""
                )
                call.respondText(payload, ContentType.Application.Json)
            }

            /** GDPR čl. 17 — žádost o smazání účtu (30 day grace period). */
            post("/delete") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val status = gdpr.requestDeletion(userId)
                call.respond(
                    DeletionStatusDto(
                        requestedAt = status.requestedAt,
                        deleteAfterAt = status.deleteAfterAt,
                        canCancel = status.canCancel,
                    )
                )
            }

            /** Status čekajícího smazání (kdy bude provedeno). */
            get("/delete") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val status = gdpr.deletionStatus(userId)
                call.respond(
                    DeletionStatusDto(
                        requestedAt = status.requestedAt,
                        deleteAfterAt = status.deleteAfterAt,
                        canCancel = status.canCancel,
                    )
                )
            }

            /** Zrušení žádosti o smazání (lze v rámci grace period). */
            delete("/delete") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                gdpr.cancelDeletion(userId)
                call.respond(HttpStatusCode.OK, mapOf("message" to "deletion_cancelled"))
            }
        }
    }
}
