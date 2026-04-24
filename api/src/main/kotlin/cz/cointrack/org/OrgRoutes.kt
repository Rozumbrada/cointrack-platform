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
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.util.UUID

fun Route.orgRoutes(orgService: OrgService) {
    // Preview pozvánky — BEZ auth (uživatel nemusí být ani přihlášen)
    route("/org/invites") {
        get("/preview") {
            val token = call.request.queryParameters["token"]
                ?: throw ApiException(HttpStatusCode.BadRequest, "missing_token", "Chybí token.")
            call.respond(orgService.previewInvite(token))
        }
    }

    authenticate("jwt") {
        route("/org") {

            // ── Organizations ─────────────────────────────────────

            post {
                val userId = call.userId()
                val req = call.receive<CreateOrganizationRequest>()
                val org = orgService.createOrganization(userId, req)
                call.respond(HttpStatusCode.Created, org)
            }

            get {
                val userId = call.userId()
                call.respond(orgService.listMyOrganizations(userId))
            }

            // ── Accept invite (nevyžaduje členství) ───────────────

            post("/invites/accept") {
                val userId = call.userId()
                val req = call.receive<AcceptInviteRequest>()
                val res = orgService.acceptInvite(req.token, userId)
                call.respond(res)
            }

            // ── Per-organization routes ───────────────────────────

            route("/{orgId}") {

                get("/members") {
                    val orgId = call.orgIdParam()
                    val userId = call.userId()
                    call.respond(orgService.listMembers(orgId, userId))
                }

                patch("/members/{userId}") {
                    val orgId = call.orgIdParam()
                    val callerId = call.userId()
                    val targetId = call.pathUuid("userId")
                    val req = call.receive<UpdateMemberRoleRequest>()
                    orgService.updateMemberRole(orgId, targetId, req.role, callerId)
                    call.respond(MessageResponse("role_updated"))
                }

                delete("/members/{userId}") {
                    val orgId = call.orgIdParam()
                    val callerId = call.userId()
                    val targetId = call.pathUuid("userId")
                    orgService.removeMember(orgId, targetId, callerId)
                    call.respond(MessageResponse("member_removed"))
                }

                // ── Invites ───────────────────────────────────────

                post("/invites") {
                    val orgId = call.orgIdParam()
                    val callerId = call.userId()
                    val req = call.receive<CreateInviteRequest>()
                    val invite = orgService.createInvite(orgId, req, callerId)
                    call.respond(HttpStatusCode.Created, invite)
                }

                get("/invites") {
                    val orgId = call.orgIdParam()
                    val callerId = call.userId()
                    call.respond(orgService.listInvites(orgId, callerId))
                }

                delete("/invites/{inviteId}") {
                    val orgId = call.orgIdParam()
                    val callerId = call.userId()
                    val inviteId = call.pathUuid("inviteId")
                    orgService.revokeInvite(orgId, inviteId, callerId)
                    call.respond(MessageResponse("invite_revoked"))
                }
            }
        }
    }
}

// ─── Helpers ───────────────────────────────────────────────────────

private fun io.ktor.server.application.ApplicationCall.userId(): UUID {
    val principal = principal<JWTPrincipal>()
        ?: throw ApiException(HttpStatusCode.Unauthorized, "unauthorized", "Neautentizováno.")
    return UUID.fromString(principal.subject)
}

private fun io.ktor.server.application.ApplicationCall.orgIdParam(): UUID =
    pathUuid("orgId")

private fun io.ktor.server.application.ApplicationCall.pathUuid(name: String): UUID {
    val raw = parameters[name]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_param", "Chybí parametr $name.")
    return try {
        UUID.fromString(raw)
    } catch (e: IllegalArgumentException) {
        throw ApiException(HttpStatusCode.BadRequest, "invalid_uuid", "Parametr $name není UUID.")
    }
}
