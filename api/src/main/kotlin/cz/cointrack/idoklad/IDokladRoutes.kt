package cz.cointrack.idoklad

import cz.cointrack.plugins.ApiException
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.time.LocalDate
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

            // ─── Plná iDoklad proxy (V21) ─────────────────────────────
            // Vytvoření vystavené faktury
            post("/invoices") {
                val userId = call.userId()
                val req = call.receive<IDokladService.CreateInvoiceRequestDto>()
                call.respond(service.createInvoice(userId, req))
            }

            // Mark-paid existující faktury (v iDokladu i Cointrack)
            post("/profiles/{profileId}/invoices/{idokladId}/mark-paid") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                val idokladId = call.parameters["idokladId"]?.toIntOrNull()
                    ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_id", "Neplatné iDoklad ID.")
                val date = call.request.queryParameters["date"]?.let {
                    runCatching { LocalDate.parse(it) }.getOrNull()
                } ?: LocalDate.now()
                service.markPaid(userId, profileId, idokladId, date)
                call.respond(mapOf("ok" to true))
            }

            // Stáhnout PDF (proxy stream z iDokladu)
            get("/profiles/{profileId}/invoices/{idokladId}/pdf") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                val idokladId = call.parameters["idokladId"]?.toIntOrNull()
                    ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_id", "Neplatné iDoklad ID.")
                val pdf = service.getPdf(userId, profileId, idokladId)
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """inline; filename="faktura-$idokladId.pdf""""
                )
                call.respondBytes(pdf, ContentType.Application.Pdf)
            }

            // Pošle fakturu emailem zákazníkovi přes iDoklad
            post("/profiles/{profileId}/invoices/{idokladId}/send-email") {
                val userId = call.userId()
                val profileId = call.pathUuid("profileId")
                val idokladId = call.parameters["idokladId"]?.toIntOrNull()
                    ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_id", "Neplatné iDoklad ID.")
                val to = call.request.queryParameters["to"]?.takeIf { it.isNotBlank() }
                service.sendEmail(userId, profileId, idokladId, to)
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
