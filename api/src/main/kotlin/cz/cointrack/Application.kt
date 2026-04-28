package cz.cointrack

import cz.cointrack.auth.AuthService
import cz.cointrack.auth.JwtConfig
import cz.cointrack.auth.JwtService
import cz.cointrack.auth.authRoutes
import cz.cointrack.ai.GeminiConfig
import cz.cointrack.ai.GeminiProxyService
import cz.cointrack.ai.geminiRoutes
import cz.cointrack.bank.BankService
import cz.cointrack.bank.SaltEdgeConfig
import cz.cointrack.bank.SaltEdgeProvider
import cz.cointrack.bank.bankRoutes
import cz.cointrack.email.EmailConfig
import cz.cointrack.email.EmailService
import cz.cointrack.idoklad.IDokladService
import cz.cointrack.idoklad.idokladRoutes
import cz.cointrack.payments.BillingExpiryWorker
import cz.cointrack.payments.FioReconciler
import cz.cointrack.payments.PaymentService
import cz.cointrack.payments.paymentRoutes
import cz.cointrack.org.AccountantService
import cz.cointrack.org.accountantRoutes
import cz.cointrack.org.OrgService
import cz.cointrack.org.orgRoutes
import cz.cointrack.org.PermissionService
import cz.cointrack.org.permissionRoutes
import cz.cointrack.plugins.*
import cz.cointrack.storage.StorageConfig
import cz.cointrack.storage.StorageService
import cz.cointrack.export.exportRoutes
import cz.cointrack.gdpr.GdprDeletionWorker
import cz.cointrack.gdpr.GdprService
import cz.cointrack.gdpr.gdprRoutes
import cz.cointrack.storage.storageRoutes
import cz.cointrack.sync.SyncService
import cz.cointrack.sync.syncRoutes
import io.ktor.server.application.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
data class HealthResponse(
    val status: String,
    val version: String,
    val environment: String,
    val timestamp: String,
)

fun main(args: Array<String>) {
    EngineMain.main(args)
}

fun Application.module() {
    configureMonitoring()
    configureSerialization()
    configureHttp()
    configureStatusPages()
    configureRateLimit()
    configureDatabase()

    val jwtConfig = loadJwtConfig()
    val emailConfig = loadEmailConfig()
    val storageConfig = loadStorageConfig()
    val webBaseUrl = environment.config.propertyOrNull("publicWebUrl")?.getString()
        ?: System.getenv("PUBLIC_WEB_URL")
        ?: "http://localhost:3000"

    val jwtService = JwtService(jwtConfig)
    val emailService = EmailService(emailConfig)
    val storageService = StorageService(storageConfig)
    val authService = AuthService(
        jwt = jwtService,
        email = emailService,
        webBaseUrl = webBaseUrl,
    )
    val syncService = SyncService()
    val orgService = OrgService(
        email = emailService,
        webBaseUrl = webBaseUrl,
    )
    val permissionService = PermissionService()
    val accountantService = AccountantService()
    val idokladService = IDokladService()
    val paymentService = PaymentService(
        config = loadPaymentConfig(),
        email = emailService,
    )
    // Fio reconciliation worker — auto mark-paid při spárování VS+částka.
    val fioReconciler = FioReconciler(
        token = System.getenv("COINTRACK_FIO_TOKEN").orEmpty(),
        payments = paymentService,
    )
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    fioReconciler.start(scope = kotlinx.coroutines.GlobalScope)

    // Billing expiry worker — denně reminder email + auto-downgrade po expiraci
    val billingExpiryWorker = BillingExpiryWorker(email = emailService, webBaseUrl = webBaseUrl)
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    billingExpiryWorker.start(scope = kotlinx.coroutines.GlobalScope)

    // Banking — pro teď jen Salt Edge. Pokud není nakonfigurovaný, bankService je null.
    val bankService: BankService? = loadBankService()

    // Gemini AI proxy (key v env, klienti volají bez vlastního klíče)
    val geminiService = loadGeminiProxy()

    // GDPR — data export + account deletion (čl. 17, 20)
    val gdprService = GdprService(storage = storageService)
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    GdprDeletionWorker().start(scope = kotlinx.coroutines.GlobalScope)

    configureSecurity(jwtService, jwtConfig)

    val version = "0.1.0"
    val env = environment.config.propertyOrNull("environment")?.getString() ?: "dev"

    routing {
        get("/health") {
            call.respond(HealthResponse(
                status = "ok",
                version = version,
                environment = env,
                timestamp = Instant.now().toString(),
            ))
        }

        route("/api/v1") {
            get("/") {
                call.respond(mapOf("name" to "Cointrack API", "version" to version))
            }

            authRoutes(authService)
            syncRoutes(syncService)
            storageRoutes(storageService)
            orgRoutes(orgService)
            permissionRoutes(permissionService)
            accountantRoutes(accountantService)
            idokladRoutes(idokladService)
            paymentRoutes(paymentService)
            if (bankService != null) bankRoutes(bankService)
            geminiRoutes(geminiService)
            exportRoutes()
            gdprRoutes(gdprService)

            // TODO (Sprint 8): billing endpoints
        }
    }
}

private fun Application.loadJwtConfig(): JwtConfig {
    val cfg = environment.config.config("jwt")
    return JwtConfig(
        secret = cfg.property("secret").getString(),
        issuer = cfg.property("issuer").getString(),
        audience = cfg.property("audience").getString(),
        accessTtlMinutes = cfg.property("accessTtlMinutes").getString().toInt(),
    )
}

private fun Application.loadEmailConfig(): EmailConfig {
    val cfg = environment.config.config("email")
    return EmailConfig(
        host = cfg.property("host").getString(),
        port = cfg.property("port").getString().toInt(),
        user = cfg.propertyOrNull("user")?.getString().orEmpty(),
        password = cfg.propertyOrNull("password")?.getString().orEmpty(),
        from = cfg.property("from").getString(),
    )
}

private fun Application.loadBankService(): BankService? {
    val bankingProvider = environment.config.propertyOrNull("banking.provider")?.getString()
        ?: "fio_only"
    if (bankingProvider != "saltedge") {
        log.info("Banking provider = $bankingProvider (Salt Edge neaktivní).")
        return null
    }
    val se = environment.config.config("saltedge")
    val appId = se.property("appId").getString()
    val secret = se.property("secret").getString()
    if (appId.isBlank() || secret.isBlank()) {
        log.warn("SALT_EDGE_APP_ID / SALT_EDGE_SECRET nejsou nastavené — banking endpointy neaktivní.")
        return null
    }
    val cfg = SaltEdgeConfig(
        appId = appId,
        secret = secret,
        baseUrl = se.property("baseUrl").getString(),
        returnUrl = se.property("returnUrl").getString(),
        callbackUrl = se.property("callbackUrl").getString(),
        privateKeyPem = se.propertyOrNull("privateKey")?.getString().orEmpty(),
        webhookPublicKeyPem = se.propertyOrNull("webhookPublicKey")?.getString().orEmpty(),
    )
    log.info("Salt Edge banking aktivován (baseUrl=${cfg.baseUrl}).")
    return BankService(
        bankingProvider = SaltEdgeProvider(cfg),
        returnUrl = cfg.returnUrl,
    )
}

private fun Application.loadGeminiProxy(): GeminiProxyService {
    val cfg = environment.config.config("gemini")
    val apiKey = cfg.propertyOrNull("apiKey")?.getString().orEmpty()
    val baseUrl = cfg.propertyOrNull("baseUrl")?.getString()
        ?: "https://generativelanguage.googleapis.com/v1beta"
    if (apiKey.isBlank()) {
        log.warn("GEMINI_API_KEY není nastavený — AI endpointy vrátí 503.")
    } else {
        log.info("Gemini AI proxy aktivován (baseUrl=$baseUrl).")
    }
    return GeminiProxyService(GeminiConfig(apiKey = apiKey, baseUrl = baseUrl))
}

private fun Application.loadStorageConfig(): StorageConfig {
    val cfg = environment.config.config("storage")
    return StorageConfig(
        endpoint = cfg.property("endpoint").getString(),
        publicEndpoint = cfg.property("publicEndpoint").getString(),
        accessKey = cfg.property("accessKey").getString(),
        secretKey = cfg.property("secretKey").getString(),
        bucket = cfg.property("bucket").getString(),
        region = cfg.property("region").getString(),
    )
}

private fun Application.loadPaymentConfig(): PaymentService.PaymentConfig {
    val iban = System.getenv("PAYMENT_IBAN")
        ?: environment.config.propertyOrNull("payment.iban")?.getString()
        ?: "CZ1520100000002601115347"   // fallback — Cointrack Fio účet
    val bankAcc = System.getenv("PAYMENT_BANK_ACCOUNT")
        ?: environment.config.propertyOrNull("payment.bankAccount")?.getString()
        ?: "2601115347/2010"
    return PaymentService.PaymentConfig(
        iban = iban,
        bankAccountDisplay = bankAcc,
        expirationDays = 7,
    )
}
