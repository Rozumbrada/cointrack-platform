package cz.cointrack.org

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
import io.ktor.server.routing.route
import java.util.UUID

fun Route.permissionRoutes(service: PermissionService) {
    authenticate("jwt") {
        route("/profiles/{profileId}/permissions") {

            get {
                val profileId = call.profileId()
                val userId = call.userIdParam()
                call.respond(service.listPermissions(profileId, userId))
            }

            post {
                val profileId = call.profileId()
                val callerId = call.userIdParam()
                val req = call.receive<GrantPermissionRequest>()
                val target = runCatching { UUID.fromString(req.userId) }.getOrNull()
                    ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_userid",
                        "userId musí být UUID.")
                val result = service.grantPermission(profileId, target, req.permission, callerId)
                call.respond(HttpStatusCode.Created, result)
            }

            delete("/{targetUserId}") {
                val profileId = call.profileId()
                val callerId = call.userIdParam()
                val target = runCatching {
                    UUID.fromString(call.parameters["targetUserId"])
                }.getOrNull()
                    ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid",
                        "targetUserId není UUID.")
                service.revokePermission(profileId, target, callerId)
                call.respond(MessageResponse("permission_revoked"))
            }
        }
    }
}

private fun io.ktor.server.application.ApplicationCall.profileId(): UUID {
    val raw = parameters["profileId"]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí profileId.")
    return runCatching { UUID.fromString(raw) }.getOrNull()
        ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "profileId není UUID.")
}

private fun io.ktor.server.application.ApplicationCall.userIdParam(): UUID {
    val p = principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    return UUID.fromString(p.subject)
}
