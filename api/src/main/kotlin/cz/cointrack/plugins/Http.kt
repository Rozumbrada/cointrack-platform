package cz.cointrack.plugins

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.calllogging.*
import io.ktor.server.plugins.compression.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.request.*
import org.slf4j.event.Level

fun Application.configureHttp() {
    install(CORS) {
        // Dev: povol všechno. V produkci omezit na web + mobilní origins.
        anyHost()
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        allowHeader("X-Client-Version")
        allowHeader("X-Device-Id")
        // Bez tohoto browser nevystaví Content-Disposition do JS, takže
        // ExportButton.tsx nedokáže přečíst filename a stáhne soubor pod
        // fallback jménem `cointrack-uctenky.xml` (Chrome pak ke každému
        // dalšímu stažení přidá " (1)", " (2)"…).
        exposeHeader(HttpHeaders.ContentDisposition)
        allowCredentials = true
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Options)
    }

    install(Compression) {
        gzip()
        deflate()
    }

    install(CallLogging) {
        level = Level.INFO
        filter { call ->
            // neloguj healthcheck spam
            !call.request.path().startsWith("/health")
        }
    }
}
