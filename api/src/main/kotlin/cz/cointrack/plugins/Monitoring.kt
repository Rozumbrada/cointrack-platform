package cz.cointrack.plugins

import io.ktor.server.application.*
import io.ktor.server.plugins.callid.*
import java.util.UUID

fun Application.configureMonitoring() {
    install(CallId) {
        header("X-Request-Id")
        generate { UUID.randomUUID().toString() }
        verify { it.isNotEmpty() }
    }
}
