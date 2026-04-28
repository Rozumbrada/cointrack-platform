package cz.cointrack.payments

import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.util.UUID

fun Route.paymentRoutes(service: PaymentService) {
    authenticate("jwt") {
        route("/payments") {
            // Start nové platby (PENDING) — vrátí QR + payment ID pro polling
            post("/start") {
                val userId = call.userId()
                val req = call.receive<PaymentService.StartRequest>()
                call.respond(service.startPayment(userId, req))
            }

            // Status konkrétní platby (pro polling)
            get("/{id}/status") {
                val userId = call.userId()
                val pid = call.pathUuid("id")
                call.respond(service.status(userId, pid))
            }

            // Seznam mých plateb (history)
            get {
                val userId = call.userId()
                call.respond(mapOf("payments" to service.listMine(userId)))
            }

            // Manuální mark-paid pro admin/testing
            // (V produkci toto bude volat Fio reconciliation worker.)
            post("/{id}/mark-paid") {
                val userId = call.userId()
                val pid = call.pathUuid("id")
                // Bezpečnostní check: jen vlastník může mark-paid sám sebe.
                // V produkci by to měl dělat jen admin nebo automatický worker.
                service.status(userId, pid)  // throws pokud není vlastník
                service.markPaid(pid)
                call.respond(mapOf("ok" to true))
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
