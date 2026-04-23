package cz.cointrack.plugins

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import cz.cointrack.auth.JwtConfig
import cz.cointrack.auth.JwtService
import io.ktor.server.application.*
import io.ktor.server.auth.*
import io.ktor.server.auth.jwt.*
import io.ktor.server.plugins.callid.*
import io.ktor.server.response.respond
import io.ktor.http.HttpStatusCode

fun Application.configureSecurity(jwtService: JwtService, jwtConfig: JwtConfig) {
    install(Authentication) {
        jwt("jwt") {
            realm = "Cointrack"
            verifier(
                JWT.require(Algorithm.HMAC256(jwtConfig.secret))
                    .withIssuer(jwtConfig.issuer)
                    .withAudience(jwtConfig.audience)
                    .build()
            )
            validate { credential ->
                if (credential.payload.subject.isNullOrBlank()) null
                else JWTPrincipal(credential.payload)
            }
            challenge { _, _ ->
                call.respond(
                    HttpStatusCode.Unauthorized,
                    ErrorResponse(
                        error = "unauthorized",
                        message = "Chybí nebo neplatný access token.",
                        requestId = call.callId,
                    )
                )
            }
        }
    }
}
