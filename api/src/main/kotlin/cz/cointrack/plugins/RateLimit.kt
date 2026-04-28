package cz.cointrack.plugins

import io.ktor.server.application.*
import io.ktor.server.plugins.callid.callId
import io.ktor.server.plugins.origin
import io.ktor.server.plugins.ratelimit.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.http.HttpStatusCode
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.hours

/**
 * Rate limiting pro auth endpointy. Klíč = klientská IP (s X-Forwarded-For
 * podporou pro reverse proxy — Caddy/Nginx).
 *
 * Limity vybrané tak, aby nezpůsobovaly false-positive při normálním použití
 * (uživatel špatně tipuje heslo), ale přitom blokovaly automated brute force.
 */
fun Application.configureRateLimit() {
    install(RateLimit) {
        // /auth/login — 5 pokusů za minutu / IP
        register(RateLimitName("login")) {
            rateLimiter(limit = 5, refillPeriod = 1.minutes)
            requestKey { call -> call.clientIp() }
        }

        // /auth/register — 5 / hodina / IP (anti-spam)
        register(RateLimitName("register")) {
            rateLimiter(limit = 5, refillPeriod = 1.hours)
            requestKey { call -> call.clientIp() }
        }

        // /auth/forgot-password — 3 / hodina / IP
        register(RateLimitName("forgot")) {
            rateLimiter(limit = 3, refillPeriod = 1.hours)
            requestKey { call -> call.clientIp() }
        }

        // /auth/reset-password — 5 / hodina / IP
        register(RateLimitName("reset")) {
            rateLimiter(limit = 5, refillPeriod = 1.hours)
            requestKey { call -> call.clientIp() }
        }

        // /auth/verify-email — 10 / hodina / IP
        register(RateLimitName("verify")) {
            rateLimiter(limit = 10, refillPeriod = 1.hours)
            requestKey { call -> call.clientIp() }
        }

        // /auth/magic-exchange — 10 / minuta / IP
        register(RateLimitName("magic")) {
            rateLimiter(limit = 10, refillPeriod = 1.minutes)
            requestKey { call -> call.clientIp() }
        }
    }
}

/**
 * Klientská IP s respektem k X-Forwarded-For (reverse proxy Caddy/Nginx).
 * Bere první IP z hlavičky (původní klient), fallback na call.request.origin.
 */
private fun io.ktor.server.application.ApplicationCall.clientIp(): String {
    val xff = request.header("X-Forwarded-For")
    if (!xff.isNullOrBlank()) return xff.split(",").first().trim()
    return request.origin.remoteHost
}
