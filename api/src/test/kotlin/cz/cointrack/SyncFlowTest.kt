package cz.cointrack

import cz.cointrack.auth.*
import cz.cointrack.email.EmailConfig
import cz.cointrack.email.EmailService
import cz.cointrack.plugins.DatabaseSingleton
import cz.cointrack.plugins.configureSecurity
import cz.cointrack.plugins.configureSerialization
import cz.cointrack.plugins.configureStatusPages
import cz.cointrack.sync.*
import io.ktor.client.call.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.Application
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import kotlinx.serialization.json.*
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SyncFlowTest {

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
    fun `push profile then pull returns it`() = testApplication {
        application { configureTestApp() }
        val client = createClient { install(ContentNegotiation) { json() } }

        // Register + login
        val email = "sync-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email, "Heslo12345"))
        }
        val auth = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "Heslo12345"))
        }.body<AuthResponse>()

        // Push profile
        val profileSyncId = UUID.randomUUID().toString()
        val nowIso = java.time.Instant.now().toString()
        val pushReq = SyncPushRequest(
            entities = mapOf(
                "profiles" to listOf(
                    SyncEntity(
                        syncId = profileSyncId,
                        updatedAt = nowIso,
                        clientVersion = 1,
                        data = buildJsonObject {
                            put("name", "Můj profil")
                            put("type", "personal")
                        },
                    )
                )
            )
        )
        val pushResp = client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(pushReq)
        }
        assertEquals(HttpStatusCode.OK, pushResp.status)
        val pushResult = pushResp.body<SyncPushResponse>()
        assertEquals(listOf(profileSyncId), pushResult.accepted["profiles"])

        // Pull — mělo by vrátit ten profil
        val pullResp = client.get("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
        }
        assertEquals(HttpStatusCode.OK, pullResp.status)
        val pullResult = pullResp.body<SyncPullResponse>()
        val profiles = pullResult.entities["profiles"]!!
        assertEquals(1, profiles.size)
        assertEquals(profileSyncId, profiles[0].syncId)
        assertEquals("Můj profil", profiles[0].data["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `push transaction with profile+account+category chain`() = testApplication {
        application { configureTestApp() }
        val client = createClient { install(ContentNegotiation) { json() } }

        val email = "chain-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email, "Heslo12345"))
        }
        val auth = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "Heslo12345"))
        }.body<AuthResponse>()

        // Vytvořím profil
        val profileId = UUID.randomUUID().toString()
        val accountId = UUID.randomUUID().toString()
        val categoryId = UUID.randomUUID().toString()
        val txId = UUID.randomUUID().toString()
        val now = java.time.Instant.now().toString()

        val push = SyncPushRequest(
            entities = mapOf(
                "profiles" to listOf(SyncEntity(
                    profileId, now, null, 1,
                    buildJsonObject { put("name", "Osobní"); put("type", "personal") }
                )),
                "accounts" to listOf(SyncEntity(
                    accountId, now, null, 1,
                    buildJsonObject {
                        put("profileId", profileId); put("name", "Hotovost")
                        put("type", "cash"); put("currency", "CZK")
                        put("initialBalance", "1000.00")
                    }
                )),
                "categories" to listOf(SyncEntity(
                    categoryId, now, null, 1,
                    buildJsonObject {
                        put("profileId", profileId); put("name", "Jídlo")
                        put("type", "expense")
                    }
                )),
                "transactions" to listOf(SyncEntity(
                    txId, now, null, 1,
                    buildJsonObject {
                        put("profileId", profileId); put("accountId", accountId)
                        put("categoryId", categoryId); put("amount", "-150.50")
                        put("currency", "CZK"); put("date", "2026-04-23")
                        put("merchant", "Albert")
                    }
                )),
            )
        )

        val resp = client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(push)
        }
        assertEquals(HttpStatusCode.OK, resp.status)

        // Pull ověří, že vše tam je
        val pull = client.get("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
        }.body<SyncPullResponse>()

        assertEquals(1, pull.entities["profiles"]!!.size)
        assertEquals(1, pull.entities["accounts"]!!.size)
        assertEquals(1, pull.entities["categories"]!!.size)
        assertEquals(1, pull.entities["transactions"]!!.size)
        assertEquals("-150.50", pull.entities["transactions"]!![0].data["amount"]!!.jsonPrimitive.content)
    }

    @Test
    fun `push with older timestamp returns conflict`() = testApplication {
        application { configureTestApp() }
        val client = createClient { install(ContentNegotiation) { json() } }

        val email = "conflict-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email, "Heslo12345"))
        }
        val auth = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "Heslo12345"))
        }.body<AuthResponse>()

        val syncId = UUID.randomUUID().toString()
        val newer = java.time.Instant.now().toString()
        val older = java.time.Instant.now().minusSeconds(3600).toString()

        // První push s novější verzí
        client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(SyncPushRequest(mapOf(
                "profiles" to listOf(SyncEntity(syncId, newer, null, 2,
                    buildJsonObject { put("name", "Nová verze"); put("type", "personal") }
                ))
            )))
        }

        // Druhý push se stejným syncId, ale starším timestampem → konflikt
        val resp = client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(SyncPushRequest(mapOf(
                "profiles" to listOf(SyncEntity(syncId, older, null, 1,
                    buildJsonObject { put("name", "Stará verze"); put("type", "personal") }
                ))
            )))
        }.body<SyncPushResponse>()

        assertTrue(resp.conflicts["profiles"]?.isNotEmpty() == true)
        assertEquals("Nová verze", resp.conflicts["profiles"]!![0].data["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `since parameter filters results`() = testApplication {
        application { configureTestApp() }
        val client = createClient { install(ContentNegotiation) { json() } }

        val email = "since-${UUID.randomUUID()}@example.com"
        client.post("/api/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(RegisterRequest(email, "Heslo12345"))
        }
        val auth = client.post("/api/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "Heslo12345"))
        }.body<AuthResponse>()

        // Uložit profil
        val t1 = java.time.Instant.now().toString()
        client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(SyncPushRequest(mapOf(
                "profiles" to listOf(SyncEntity(
                    UUID.randomUUID().toString(), t1, null, 1,
                    buildJsonObject { put("name", "P1"); put("type", "personal") }
                ))
            )))
        }

        // Čekání, pak další profil
        Thread.sleep(50)
        val t2 = java.time.Instant.now().toString()
        client.post("/api/v1/sync") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
            contentType(ContentType.Application.Json)
            setBody(SyncPushRequest(mapOf(
                "profiles" to listOf(SyncEntity(
                    UUID.randomUUID().toString(), t2, null, 1,
                    buildJsonObject { put("name", "P2"); put("type", "business") }
                ))
            )))
        }

        // Pull since t1 — vrátí jen P2
        val pull = client.get("/api/v1/sync?since=$t1") {
            header(HttpHeaders.Authorization, "Bearer ${auth.accessToken}")
        }.body<SyncPullResponse>()

        val profiles = pull.entities["profiles"] ?: emptyList()
        assertEquals(1, profiles.size)
        assertEquals("P2", profiles[0].data["name"]!!.jsonPrimitive.content)
    }

    private fun Application.configureTestApp() {
        val jwtConfig = JwtConfig(
            secret = "test_secret_0123456789_abcdef_xxxxxxxxxxxxxxxxxxxxxxxx",
            issuer = "cointrack-test",
            audience = "cointrack-test",
            accessTtlMinutes = 15,
        )
        val jwtService = JwtService(jwtConfig)
        val emailService = object : EmailService(EmailConfig("noop", 0, "", "", "noop@noop")) {
            override suspend fun send(to: String, subject: String, htmlBody: String) {}
        }
        val authService = AuthService(jwtService, emailService, "http://localhost:3000")
        val syncService = SyncService()

        configureSerialization()
        configureStatusPages()
        configureSecurity(jwtService, jwtConfig)

        routing {
            route("/api/v1") {
                authRoutes(authService)
                syncRoutes(syncService)
            }
        }
    }
}
