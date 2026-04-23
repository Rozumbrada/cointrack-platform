package cz.cointrack.plugins

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.*
import io.ktor.server.plugins.callid.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.response.*
import kotlinx.serialization.Serializable

@Serializable
data class ErrorResponse(
    val error: String,
    val message: String,
    val requestId: String? = null,
)

class ApiException(
    val status: HttpStatusCode,
    val errorCode: String,
    override val message: String,
) : RuntimeException(message)

fun Application.configureStatusPages() {
    install(StatusPages) {
        exception<ApiException> { call, cause ->
            call.respond(
                status = cause.status,
                message = ErrorResponse(
                    error = cause.errorCode,
                    message = cause.message,
                    requestId = call.callId,
                )
            )
        }
        exception<BadRequestException> { call, cause ->
            call.respond(
                HttpStatusCode.BadRequest,
                ErrorResponse(
                    error = "bad_request",
                    message = cause.message ?: "Bad request",
                    requestId = call.callId,
                )
            )
        }
        exception<Throwable> { call, cause ->
            call.application.log.error("Unhandled exception", cause)
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorResponse(
                    error = "internal_error",
                    message = "Internal server error",
                    requestId = call.callId,
                )
            )
        }
        status(HttpStatusCode.NotFound) { call, _ ->
            call.respond(
                HttpStatusCode.NotFound,
                ErrorResponse(
                    error = "not_found",
                    message = "Endpoint not found",
                    requestId = call.callId,
                )
            )
        }
    }
}
