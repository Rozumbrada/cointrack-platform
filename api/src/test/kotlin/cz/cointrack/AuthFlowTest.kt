package cz.cointrack

import cz.cointrack.auth.*
import cz.cointrack.email.EmailConfig
import cz.cointrack.email.EmailService
import cz.cointrack.plugins.DatabaseSingleton
import cz.cointrack.plugins.configureSecurity
import cz.cointrack.plugins.configureSerialization
import cz.cointrack.plugins.configureStatusPages
import io.ktor.client.call.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.auth.jwt.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * End-to-end test auth flow proti reálnému Postgresu v kontejneru.
 * Spustí Flyway migrace a volá endpointy přes testApplication.
 *
 * Email je mockovaný (noop) — testujeme jen auth logiku.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthFlowTest {

    private lateinit var postgres: EmbeddedPostgres

    @BeforeAll
    fun setup() {
        postgres = EmbeddedPostgres.builder().start()
        DatabaseSingleton.init(
            host = "localhost",
            port = postgres.port,
            name = "postgres",
            user = "postgres",
            password = "postgres",
        )
    }

    @AfterAll
    fun teardown() {
        DatabaseSingleton.close()
        postgres.close()
    }

    @Test
    fun `register then login then fetch me`() = testApplication {
        application { configureTestApp() }

        val client = createClient {
            install(ContentNegotiation) { json() }
        }

        // 1. Register
        val email = "user-${UUID.randomUUID()}@example.com"
        val registerResp = client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email = email, password = "ValidPass123"))
        }
        assertEquals(HttpStatusCode.Created, registerResp.status)

        // 2. Login
        val loginResp = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email = email, password = "ValidPass123"))
        }
        assertEquals(HttpStatusCode.OK, loginResp.status)
        val auth = loginResp.body<AuthResponse>()
        assertNotNull(auth.accessToken)
        assertNotNull(auth.refreshToken)
        assertEquals(email, auth.user.email)

        // 3. Me (s access tokenem)
        val meResp = client.get("/api/v1/auth/me") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
        }
        assertEquals(HttpStatusCode.OK, meResp.status)
        val me = meResp.body<UserDto>()
        assertEquals(email, me.email)
        assertEquals("free", me.tier)
    }

    @Test
    fun `login with wrong password returns 401`() = testApplication {
        application { configureTestApp() }

        val client = createClient { install(ContentNegotiation) { json() } }

        val email = "wrong-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email = email, password = "ValidPass123"))
        }

        val resp = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email = email, password = "WrongPass999"))
        }
        assertEquals(HttpStatusCode.Unauthorized, resp.status)
    }

    @Test
    fun `refresh issues new tokens and revokes old`() = testApplication {
        application { configureTestApp() }

        val client = createClient { install(ContentNegotiation) { json() } }

        val email = "refresh-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email = email, password = "ValidPass123"))
        }
        val first = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email = email, password = "ValidPass123"))
        }.body<AuthResponse>()

        val refreshed = client.post("/api/v1/auth/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(first.refreshToken))
        }
        assertEquals(HttpStatusCode.OK, refreshed.status)
        val second = refreshed.body<AuthResponse>()

        // Staré refresh token už nelze použít
        val reuse = client.post("/api/v1/auth/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(first.refreshToken))
        }
        assertEquals(HttpStatusCode.Unauthorized, reuse.status)
        assertNotNull(second.accessToken)
    }

    private fun io.ktor.server.application.Application.configureTestApp() {
        val jwtConfig = JwtConfig(
            secret = "test_secret_0123456789_abcdef_xxxxxxxxxxxxxxxxxxxxxxxx",
            issuer = "cointrack-test",
            audience = "cointrack-test",
            accessTtlMinutes = 15,
        )
        val jwtService = JwtService(jwtConfig)
        val emailService = object : EmailService(EmailConfig("noop", 0, "", "", "noop@noop")) {
            override suspend fun send(to: String, subject: String, htmlBody: String) {
                // Noop — netestujeme email
            }
        }
        val authService = AuthService(
            jwt = jwtService,
            email = emailService,
            webBaseUrl = "http://localhost:3000",
        )

        configureSerialization()
        configureStatusPages()
        configureSecurity(jwtService, jwtConfig)

        routing {
            route("/api/v1") {
                authRoutes(authService)
            }
        }
    }
}
