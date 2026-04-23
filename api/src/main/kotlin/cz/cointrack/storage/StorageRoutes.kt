package cz.cointrack.storage

import cz.cointrack.db.Files
import cz.cointrack.db.db
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
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import java.time.Instant
import java.util.UUID

@Serializable
data class UploadUrlRequest(
    val contentType: String,
    val purpose: String,     // receipt | invoice | warranty | avatar
    val sizeBytes: Long? = null,
)

@Serializable
data class UploadUrlResponse(
    val uploadUrl: String,
    val storageKey: String,
    val expiresIn: Int,   // sekundy
)

@Serializable
data class DownloadUrlResponse(
    val downloadUrl: String,
    val expiresIn: Int,
)

private val allowedPurposes = setOf("receipt", "invoice", "warranty", "avatar")
private val allowedContentTypes = setOf(
    "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/pdf"
)
private const val MAX_SIZE_BYTES = 20L * 1024 * 1024  // 20 MB

fun Route.storageRoutes(storage: StorageService) {
    authenticate("jwt") {
        route("/files") {

            /**
             * POST /api/v1/files/upload-url
             *
             * Server vydá presigned URL, na kterou klient PUTne soubor.
             * Klient pak pošle storageKey při uložení entity (receipt.photoKeys, invoice.fileKeys, ...).
             */
            post("/upload-url") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val req = call.receive<UploadUrlRequest>()

                if (req.purpose !in allowedPurposes) {
                    throw ApiException(HttpStatusCode.BadRequest, "invalid_purpose",
                        "Purpose musí být jeden z: ${allowedPurposes.joinToString()}")
                }
                if (req.contentType !in allowedContentTypes) {
                    throw ApiException(HttpStatusCode.BadRequest, "invalid_content_type",
                        "Povolené typy: ${allowedContentTypes.joinToString()}")
                }
                if (req.sizeBytes != null && req.sizeBytes > MAX_SIZE_BYTES) {
                    throw ApiException(HttpStatusCode.BadRequest, "file_too_large",
                        "Max velikost je ${MAX_SIZE_BYTES / 1024 / 1024} MB.")
                }

                val extension = req.contentType.substringAfter("/").replace("jpeg", "jpg")
                val storageKey = "$userId/${req.purpose}/${UUID.randomUUID()}.$extension"
                val url = storage.presignUpload(storageKey, req.contentType)

                db {
                    Files.insert {
                        it[ownerUserId] = userId
                        it[Files.storageKey] = storageKey
                        it[contentType] = req.contentType
                        it[sizeBytes] = req.sizeBytes
                        it[purpose] = req.purpose
                        it[createdAt] = Instant.now()
                    }
                }

                call.respond(UploadUrlResponse(
                    uploadUrl = url,
                    storageKey = storageKey,
                    expiresIn = 15 * 60,
                ))
            }

            /**
             * GET /api/v1/files/download-url?key=<storageKey>
             *
             * Vrátí presigned GET URL s platností 5 minut.
             */
            get("/download-url") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val storageKey = call.request.queryParameters["key"]
                    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_key", "Chybí parametr 'key'.")

                val file = db {
                    Files.selectAll()
                        .where { Files.storageKey eq storageKey }
                        .singleOrNull()
                } ?: throw ApiException(HttpStatusCode.NotFound, "file_not_found", "Soubor nenalezen.")

                if (file[Files.ownerUserId].value != userId) {
                    throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Nemáš přístup k tomuto souboru.")
                }

                val url = storage.presignDownload(storageKey)
                call.respond(DownloadUrlResponse(downloadUrl = url, expiresIn = 5 * 60))
            }
        }
    }
}
