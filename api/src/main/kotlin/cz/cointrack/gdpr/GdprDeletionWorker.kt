package cz.cointrack.gdpr

import cz.cointrack.db.Users
import cz.cointrack.db.db
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.lessEq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.selectAll
import org.slf4j.LoggerFactory
import java.time.Instant

/**
 * Hard-delete worker — jednou denně mažeme účty, kde delete_after_at < now().
 * Smazání je kaskádové (FK ON DELETE CASCADE v migracích) — stačí smazat
 * `users` row, ostatní entity se smažou samy.
 *
 * Soubory v S3 zůstávají (storage_keys už ale nikdo nemůže získat — JWT
 * je vypadlý). Lze přidat S3 cleanup později.
 */
class GdprDeletionWorker(
    private val intervalMillis: Long = 24L * 60 * 60 * 1000L,
) {
    private val log = LoggerFactory.getLogger(GdprDeletionWorker::class.java)

    fun start(scope: CoroutineScope) {
        scope.launch(Dispatchers.IO) {
            log.info("GdprDeletionWorker started, interval=${intervalMillis / 60_000} min.")
            // Initial 5 min delay — ať server nestartuje hned s mazáním.
            delay(5 * 60 * 1000L)
            while (true) {
                runCatching { tickOnce() }.onFailure {
                    log.warn("GdprDeletionWorker tick failed: ${it.message}")
                }
                delay(intervalMillis)
            }
        }
    }

    suspend fun tickOnce(): Int = db {
        val now = Instant.now()
        val rows = Users.selectAll().where {
            Users.deleteAfterAt.isNotNull() and (Users.deleteAfterAt lessEq now)
        }.toList()

        if (rows.isEmpty()) return@db 0

        var count = 0
        for (row in rows) {
            val id = row[Users.id].value
            val email = row[Users.email]
            try {
                Users.deleteWhere { Users.id eq id }
                log.info("GDPR hard-deleted user $id ($email)")
                count++
            } catch (e: Exception) {
                log.error("GDPR hard-delete failed for $id: ${e.message}")
            }
        }
        count
    }
}
