package cz.cointrack.payments

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.math.BigDecimal

/**
 * Periodicky čte Cointrack firemní Fio účet a páruje příchozí platby na PENDING
 * záznamy v `payments` tabulce podle variabilního symbolu + částky.
 *
 * Spouští se v Application.module() jako background coroutine. Token je
 * v env COINTRACK_FIO_TOKEN (read-only Fio API token).
 *
 * Fio API rate-limit: 1 dotaz / 30 s na token. Worker volá každých 5 minut,
 * což je s rezervou.
 *
 * /last/ vrací jen transakce od posledního dotazu (server-side bookmark) →
 * idempotentní bez nutnosti udržovat lokální cursor.
 */
class FioReconciler(
    private val token: String,
    private val payments: PaymentService,
    private val intervalMillis: Long = 5 * 60 * 1000L,
) {
    private val log = LoggerFactory.getLogger(FioReconciler::class.java)

    private val client = HttpClient(CIO) {
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 30_000
        }
        expectSuccess = false
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    val isConfigured: Boolean get() = token.isNotBlank()

    /**
     * Nastartuje background loop. Volat z Application.module():
     *   FioReconciler(token, paymentService).start(scope)
     */
    fun start(scope: kotlinx.coroutines.CoroutineScope) {
        if (!isConfigured) {
            log.info("FioReconciler: COINTRACK_FIO_TOKEN není nastaven, worker se nespustí.")
            return
        }
        scope.launch(Dispatchers.IO) {
            log.info("FioReconciler started, interval ${intervalMillis / 60_000} min.")
            while (true) {
                runCatching { tickOnce() }.onFailure {
                    log.warn("FioReconciler tick failed: ${it.message}")
                }
                delay(intervalMillis)
            }
        }
    }

    suspend fun tickOnce(): Int {
        val resp = client.get("https://fioapi.fio.cz/v1/rest/last/$token/transactions.json")
        if (!resp.status.isSuccess()) {
            // 422 = bookmark out of range (po prvním spuštění); 409 = rate limit; jinak chyba
            log.warn("FioReconciler: Fio API odpověděl ${resp.status}, přeskakuji tento tick.")
            return 0
        }
        val body = resp.bodyAsText()
        val account = runCatching { json.decodeFromString(FioAccountResponse.serializer(), body) }
            .getOrElse {
                log.warn("FioReconciler: nelze parsovat Fio response: ${it.message}")
                return 0
            }

        val transactions = account.accountStatement?.transactionList?.transaction ?: emptyList()
        if (transactions.isEmpty()) return 0

        var matched = 0
        for (tx in transactions) {
            val amount = tx.column1?.value ?: continue        // amount
            if (amount <= 0.0) continue                       // jen příchozí (kladné)
            val vs = tx.column5?.value?.takeIf { it.isNotBlank() } ?: continue
            val txId = tx.column22?.value?.toString() ?: ""

            val paymentId = payments.findPendingByVariableSymbol(vs, BigDecimal.valueOf(amount))
            if (paymentId != null) {
                runCatching { payments.markPaid(paymentId, matchedTxId = txId) }
                    .onSuccess {
                        matched++
                        log.info("FioReconciler: spárováno VS=$vs amount=$amount → payment $paymentId")
                    }
                    .onFailure { log.warn("FioReconciler: markPaid selhal pro VS=$vs: ${it.message}") }
            }
        }
        return matched
    }

    // ─── Fio JSON DTOs (jen co potřebujeme) ────────────────────────────

    @Serializable
    data class FioAccountResponse(
        val accountStatement: AccountStatement? = null,
    )

    @Serializable
    data class AccountStatement(
        val transactionList: TransactionList? = null,
    )

    @Serializable
    data class TransactionList(
        val transaction: List<FioTx> = emptyList(),
    )

    @Serializable
    data class FioTx(
        val column1: FioCol<Double>? = null,    // amount
        val column5: FioCol<String>? = null,    // VS
        val column22: FioCol<Long>? = null,     // unique tx ID
    )

    @Serializable
    data class FioCol<T>(
        val value: T? = null,
        val name: String? = null,
        val id: Int? = null,
    )
}
