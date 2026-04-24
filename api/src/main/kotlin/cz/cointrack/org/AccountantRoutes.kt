package cz.cointrack.org

import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import java.util.UUID

fun Route.accountantRoutes(service: AccountantService) {
    authenticate("jwt") {
        route("/accounting") {
            get("/orgs") {
                val userId = call.userId()
                call.respond(service.listMyOrgs(userId))
            }

            get("/orgs/{orgId}/receipts") {
                val userId = call.userId()
                val orgId = call.pathUuid("orgId")
                call.respond(mapOf("receipts" to service.listReceipts(userId, orgId)))
            }

            get("/orgs/{orgId}/invoices") {
                val userId = call.userId()
                val orgId = call.pathUuid("orgId")
                call.respond(mapOf("invoices" to service.listInvoices(userId, orgId)))
            }
        }
    }
}

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
