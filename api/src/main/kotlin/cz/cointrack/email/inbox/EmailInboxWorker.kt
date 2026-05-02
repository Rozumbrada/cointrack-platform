package cz.cointrack.email.inbox

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import kotlin.time.Duration.Companion.minutes

/**
 * Background worker pro email inbox sync.
 *
 * Cyklus: každých 15 minut zkontroluje, které schránky jsou "due" (poslední sync
 * + interval < teď) a spustí jejich sync sériově (ne concurrently — IMAP login
 * je drahý, jednu zprávu naráz stačí). Při chybě jednoho účtu pokračuje v dalším.
 */
class EmailInboxWorker(private val service: EmailInboxService) {

    private val log = LoggerFactory.getLogger(EmailInboxWorker::class.java)

    fun start(scope: CoroutineScope) {
        scope.launch {
            log.info("Email inbox worker started.")
            // Initial delay — necháme aplikaci se rozjet
            delay(2.minutes)
            while (true) {
                try {
                    val due = service.findDueAccounts()
                    if (due.isNotEmpty()) {
                        log.info("Email inbox worker: {} due accounts.", due.size)
                    }
                    for (accId in due) {
                        try {
                            val result = service.syncAccount(accId)
                            log.info(
                                "Email inbox sync {} → ok={} processed={} created={} skipped={}",
                                accId, result.ok, result.processed, result.invoicesCreated, result.skipped,
                            )
                        } catch (e: Exception) {
                            log.warn("Email inbox sync failed for {}: {}", accId, e.message)
                        }
                    }
                } catch (e: Exception) {
                    log.error("Email inbox worker tick failed", e)
                }
                delay(15.minutes)
            }
        }
    }
}
