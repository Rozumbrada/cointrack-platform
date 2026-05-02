package cz.cointrack.export

import cz.cointrack.db.Invoices
import cz.cointrack.db.Profiles
import cz.cointrack.db.Receipts
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
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Export endpointy.
 *
 *   GET /api/v1/export/receipts.xml?profileId=UUID
 *       &from=YYYY-MM-DD       (optional)
 *       &to=YYYY-MM-DD         (optional)
 *       &ids=syncId1,syncId2…  (optional — má přednost před from/to)
 *
 *   GET /api/v1/export/invoices.xml?profileId=UUID&from=&to=&ids=
 *
 * Pokud je `ids` předán, server exportuje JEN tyto entity (bez ohledu na from/to).
 * Pokud není, použije from/to filter (= aktuální chování). Pokud chybí oba,
 * exportuje vše v profilu.
 *
 * Profil musí patřit autentizovanému userovi.
 * Vrací `application/xml` s `Content-Disposition: attachment`.
 */
fun Route.exportRoutes() {
    authenticate("jwt") {
        route("/export") {

            get("/receipts.xml") {
                val (profileDbId, from, to, ids) = parseExportParams(call)
                val xml = PohodaExporter.exportReceipts(profileDbId, from, to, ids = ids)
                if (xml.isEmpty()) {
                    throw ApiException(
                        HttpStatusCode.NotFound,
                        "no_receipts",
                        "Žádné účtenky pro export v zadaném období.",
                    )
                }
                // V28: po úspěšném vygenerování označ exportované účtenky.
                markReceiptsExported(profileDbId, from, to, ids)
                val profileName = profileNameFor(profileDbId)
                val filename = filenameFor("uctenky", profileName, from, to, ids)
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """attachment; filename="$filename"""",
                )
                call.respondText(xml, ContentType.Application.Xml)
            }

            get("/invoices.xml") {
                val (profileDbId, from, to, ids) = parseExportParams(call)
                val xml = PohodaExporter.exportInvoices(profileDbId, from, to, ids = ids)
                if (xml.isEmpty()) {
                    throw ApiException(
                        HttpStatusCode.NotFound,
                        "no_invoices",
                        "Žádné faktury pro export v zadaném období.",
                    )
                }
                markInvoicesExported(profileDbId, from, to, ids)
                val profileName = profileNameFor(profileDbId)
                val filename = filenameFor("faktury", profileName, from, to, ids)
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    """attachment; filename="$filename"""",
                )
                call.respondText(xml, ContentType.Application.Xml)
            }
        }
    }
}

/**
 * Sanitizuje řetězec pro použití ve jménu souboru.
 *  - diakritika přepisuje na ASCII (Š→S, ě→e, …)
 *  - mezery, lomítka a další "nebezpečné" znaky → "-"
 *  - odstraní vícenásobné pomlčky a leading/trailing pomlčky
 *  - prázdný/null vrátí "profil"
 */
private fun slugify(input: String?): String {
    if (input.isNullOrBlank()) return "profil"
    val normalized = java.text.Normalizer.normalize(input, java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
    return normalized
        .replace(Regex("[^a-zA-Z0-9]+"), "-")
        .trim('-')
        .lowercase()
        .ifBlank { "profil" }
}

/**
 * Sestaví jméno souboru pro export. Formát:
 *   cointrack-{prefix}-{profileSlug}-{date}.xml
 *
 * Pokud je `ids` (ruční výběr) — připojí "vyber-N" místo data, datum je dnešní.
 * Pokud je `from`/`to` rozsah — použije ho. Jinak dnešní datum.
 *
 * Příklady:
 *   cointrack-uctenky-estedent-2026-05-02.xml
 *   cointrack-uctenky-estedent-vyber-15-2026-05-02.xml
 *   cointrack-faktury-osobni-2026-04-01_2026-04-30.xml
 */
private fun filenameFor(
    prefix: String,
    profileName: String,
    from: LocalDate?,
    to: LocalDate?,
    ids: List<UUID>?,
): String {
    val slug = slugify(profileName)
    val today = LocalDate.now()
    val suffix = when {
        !ids.isNullOrEmpty() -> "vyber-${ids.size}-$today"
        from != null && to != null -> "${from}_$to"
        from != null -> "od-$from"
        to != null -> "do-$to"
        else -> today.toString()
    }
    return "cointrack-$prefix-$slug-$suffix.xml"
}

private suspend fun profileNameFor(profileDbId: UUID): String = db {
    Profiles.selectAll().where { Profiles.id eq EntityID(profileDbId, Profiles) }
        .singleOrNull()
        ?.let { it[Profiles.companyName] ?: it[Profiles.name] }
        ?: "profil"
}

private data class ExportParams(
    val profileDbId: UUID,
    val from: LocalDate?,
    val to: LocalDate?,
    /** Konkrétní syncIds k exportu (priorita před from/to). null = žádný explicitní výběr. */
    val ids: List<UUID>?,
)

private suspend fun parseExportParams(call: io.ktor.server.application.ApplicationCall): ExportParams {
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

    // ?ids=uuid1,uuid2,uuid3 — ručně vybraný export. Pokud není zadáno (null nebo empty),
    // použije se from/to filter; pokud je [], vrátí prázdný export (== nic vybráno).
    val ids = call.request.queryParameters["ids"]?.takeIf { it.isNotBlank() }?.let { raw ->
        raw.split(",").map { it.trim() }.filter { it.isNotBlank() }.map { idStr ->
            runCatching { UUID.fromString(idStr) }.getOrElse {
                throw ApiException(HttpStatusCode.BadRequest, "invalid_ids", "Neplatné UUID v 'ids': $idStr")
            }
        }
    }

    return ExportParams(profileDbId, from, to, ids)
}

// ─── Mark exported helpers ──────────────────────────────────────────────
//
// Po úspěšném vygenerování XML (= router.respondText) označíme dotčené řádky
// exported_at = now(). Filtruje se stejně jako PohodaExporter.exportXxx —
// pokud byl ids list, jen ty; jinak from/to date filter.

private suspend fun markReceiptsExported(
    profileDbId: UUID,
    from: LocalDate?,
    to: LocalDate?,
    ids: List<UUID>?,
) = db {
    val now = Instant.now()
    if (!ids.isNullOrEmpty()) {
        Receipts.update({
            (Receipts.profileId eq EntityID(profileDbId, Profiles)) and
                (Receipts.syncId inList ids) and
                Receipts.deletedAt.isNull()
        }) { it[exportedAt] = now }
    } else {
        Receipts.update({
            (Receipts.profileId eq EntityID(profileDbId, Profiles)) and
                Receipts.deletedAt.isNull() and
                (if (from != null) Receipts.date greaterEq from else org.jetbrains.exposed.sql.Op.TRUE) and
                (if (to != null) Receipts.date lessEq to else org.jetbrains.exposed.sql.Op.TRUE)
        }) { it[exportedAt] = now }
    }
}

private suspend fun markInvoicesExported(
    profileDbId: UUID,
    from: LocalDate?,
    to: LocalDate?,
    ids: List<UUID>?,
) = db {
    val now = Instant.now()
    if (!ids.isNullOrEmpty()) {
        Invoices.update({
            (Invoices.profileId eq EntityID(profileDbId, Profiles)) and
                (Invoices.syncId inList ids) and
                Invoices.deletedAt.isNull()
        }) { it[exportedAt] = now }
    } else {
        Invoices.update({
            (Invoices.profileId eq EntityID(profileDbId, Profiles)) and
                Invoices.deletedAt.isNull() and
                (if (from != null) Invoices.issueDate greaterEq from else org.jetbrains.exposed.sql.Op.TRUE) and
                (if (to != null) Invoices.issueDate lessEq to else org.jetbrains.exposed.sql.Op.TRUE)
        }) { it[exportedAt] = now }
    }
}
