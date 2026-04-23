package cz.cointrack.auth

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

fun Route.authRoutes(authService: AuthService) {

    route("/auth") {

        post("/register") {
            val req = call.receive<RegisterRequest>()
            val user = authService.register(req)
            call.respond(HttpStatusCode.Created, user)
        }

        post("/login") {
            val req = call.receive<LoginRequest>()
            val res = authService.login(req)
            call.respond(res)
        }

        post("/refresh") {
            val req = call.receive<RefreshRequest>()
            val res = authService.refresh(req.refreshToken)
            call.respond(res)
        }

        post("/logout") {
            val req = call.receive<RefreshRequest>()
            authService.logout(req.refreshToken)
            call.respond(MessageResponse("logged_out"))
        }

        post("/verify-email") {
            val req = call.receive<VerifyEmailRequest>()
            authService.verifyEmail(req.token)
            call.respond(MessageResponse("email_verified"))
        }

        post("/forgot-password") {
            val req = call.receive<ForgotPasswordRequest>()
            authService.forgotPassword(req.email)
            // Vždy respond 200, nikdy neprozrazuj, jestli email existuje
            call.respond(MessageResponse("if_exists_email_sent"))
        }

        post("/reset-password") {
            val req = call.receive<ResetPasswordRequest>()
            authService.resetPassword(req.token, req.newPassword)
            call.respond(MessageResponse("password_updated"))
        }

        authenticate("jwt") {
            get("/me") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val user = authService.me(userId)
                call.respond(user)
            }
        }
    }
}
