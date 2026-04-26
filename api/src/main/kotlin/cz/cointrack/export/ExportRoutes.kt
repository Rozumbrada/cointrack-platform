package cz.cointrack.export

import cz.cointrack.db.Profiles
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import org.jetbrains.exposed.sql.selectAll
import java.time.LocalDate
import java.util.UUID

/**
 * Export endpointy.
 *
 *   GET /api/v1/export/receipts.xml?profileId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /api/v1/export/invoices.xml?profileId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Profil musí patřit autentizovanému userovi (přes Profiles.cointrackUserId
 * nebo přes členství v organizaci, kterou profil vlastní).
 *
 * Vrací `application/xml` s `Content-Disposition: attachment` (browser stáhne soubor).
 */
fun Route.exportRoutes() {
    authenticate("jwt") {
        route("/export") {

            get("/receipts.xml") {
                val (profileDbId, from, to) = parseExportParams(call)
                val xml = PohodaExporter.exportReceipts(profileDbId, from, to)
                if (xml.isEmpty()) {
                    throw ApiException(
                        HttpStatusCode.NotFound,
                        "no_receipts",
                        "Žádné účtenky pro export v zadaném období.",
                    )
                }
                val filename = "cointrack-uctenky-${from ?: "all"}_${to ?: "all"}.xml"
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """attachment; filename="$filename"""",
                )
                call.respondText(xml, ContentType.Application.Xml)
            }

            get("/invoices.xml") {
                val (profileDbId, from, to) = parseExportParams(call)
                val xml = PohodaExporter.exportInvoices(profileDbId, from, to)
                if (xml.isEmpty()) {
                    throw ApiException(
                        HttpStatusCode.NotFound,
                        "no_invoices",
                        "Žádné faktury pro export v zadaném období.",
                    )
                }
                val filename = "cointrack-faktury-${from ?: "all"}_${to ?: "all"}.xml"
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """attachment; filename="$filename"""",
                )
                call.respondText(xml, ContentType.Application.Xml)
            }
        }
    }
}

private suspend fun parseExportParams(call: io.ktor.server.application.ApplicationCall): Triple<UUID, LocalDate?, LocalDate?> {
    val principal = call.principal<JWTPrincipal>()!!
    val userId = UUID.fromString(principal.subject)

    val profileSyncId = call.request.queryParameters["profileId"]
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_profile", "Chybí parametr 'profileId'.")
    val profileSyncUuid = runCatching { UUID.fromString(profileSyncId) }.getOrElse {
        throw ApiException(HttpStatusCode.BadRequest, "invalid_profile", "Neplatný 'profileId'.")
    }

    val profile = db {
        Profiles.selectAll().where { Profiles.syncId eq profileSyncUuid }.singleOrNull()
    } ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")

    // Ověření, že profil patří userovi (osobní profil; org-level kontrolu zatím přeskočíme).
    val profileOwner = profile[Profiles.ownerUserId].value
    if (profileOwner != userId) {
        throw ApiException(HttpStatusCode.Forbidden, "forbidden", "K tomuto profilu nemáš přístup.")
    }

    val profileDbId = profile[Profiles.id].value

    val from = call.request.queryParameters["from"]?.let {
        runCatching { LocalDate.parse(it) }.getOrElse {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_from", "Neplatný 'from' (YYYY-MM-DD).")
        }
    }
    val to = call.request.queryParameters["to"]?.let {
        runCatching { LocalDate.parse(it) }.getOrElse {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_to", "Neplatný 'to' (YYYY-MM-DD).")
        }
    }

    return Triple(profileDbId, from, to)
}
