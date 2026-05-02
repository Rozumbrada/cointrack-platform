package cz.cointrack.auth

import io.ktor.http.HttpStatusCode
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.plugins.ratelimit.RateLimitName
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import java.util.UUID

fun Route.authRoutes(authService: AuthService) {

    route("/auth") {

        rateLimit(RateLimitName("register")) {
            post("/register") {
                val req = call.receive<RegisterRequest>()
                // Register vydá rovnou tokens — UX flow: register → tokens uložené
                // → "čekáme na ověření emailu" obrazovka → po verify auto-redirect.
                val res = authService.register(req)
                call.respond(HttpStatusCode.Created, res)
            }
        }

        rateLimit(RateLimitName("login")) {
            post("/login") {
                val req = call.receive<LoginRequest>()
                val res = authService.login(req)
                call.respond(res)
            }
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

        rateLimit(RateLimitName("verify")) {
            post("/verify-email") {
                val req = call.receive<VerifyEmailRequest>()
                authService.verifyEmail(req.token)
                call.respond(MessageResponse("email_verified"))
            }
        }

        rateLimit(RateLimitName("forgot")) {
            post("/forgot-password") {
                val req = call.receive<ForgotPasswordRequest>()
                authService.forgotPassword(req.email)
                // Vždy respond 200, nikdy neprozrazuj, jestli email existuje
                call.respond(MessageResponse("if_exists_email_sent"))
            }
        }

        rateLimit(RateLimitName("reset")) {
            post("/reset-password") {
                val req = call.receive<ResetPasswordRequest>()
                authService.resetPassword(req.token, req.newPassword)
                call.respond(MessageResponse("password_updated"))
            }
        }

        authenticate("jwt") {
            get("/me") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val user = authService.me(userId)
                call.respond(user)
            }

            // PATCH /auth/me { locale?: string, displayName?: string }
            patch("/me") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val req = call.receive<UpdateMeRequest>()
                val user = authService.updateMe(userId, req)
                call.respond(user)
            }

            // POST /auth/magic-link { nextPath?: "/app/upgrade" } → { url }
            post("/magic-link") {
                val principal = call.principal<JWTPrincipal>()!!
                val userId = UUID.fromString(principal.subject)
                val req = call.receive<MagicLinkRequest>()
                val url = authService.createMagicLink(userId, req.nextPath)
                call.respond(MagicLinkResponse(url))
            }
        }

        // Public — magic exchange (no auth required, consumes token)
        rateLimit(RateLimitName("magic")) {
            post("/magic-exchange") {
                val req = call.receive<MagicExchangeRequest>()
                val res = authService.exchangeMagic(req.token)
                call.respond(res)
            }
        }
    }
}
