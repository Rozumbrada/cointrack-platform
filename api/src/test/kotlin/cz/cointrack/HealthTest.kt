package cz.cointrack

import cz.cointrack.plugins.configureSerialization
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.time.Instant

/**
 * Smoke test — ověří, že health endpoint odpovídá.
 * Běží bez DB, testuje jen routing + serializaci.
 */
class HealthTest {

    @Test
    fun `health endpoint returns ok`() = testApplication {
        application {
            configureSerialization()
            routing {
                get("/health") {
                    call.respond(HealthResponse(
                        status = "ok",
                        version = "test",
                        environment = "test",
                        timestamp = Instant.now().toString(),
                    ))
                }
            }
        }

        val response = client.get("/health")
        assertEquals(HttpStatusCode.OK, response.status)

        val body = response.bodyAsText()
        assertTrue(body.contains("\"status\":\"ok\""))
    }
}
