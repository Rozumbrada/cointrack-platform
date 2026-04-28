package cz.cointrack.payments

import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.email.EmailService
import cz.cointrack.email.EmailTemplates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Denně:
 *  1) Pošle reminder email uživatelům, kterým tier vyprší za 6-7 dnů
 *     a kterým reminder ještě nebyl poslán (nebo byl posílán dávno).
 *  2) Provede auto-downgrade všem uživatelům s expirovaným tier:
 *     tier → FREE, tier_expires_at → null, pošle "downgraded" email.
 *
 * Záměrně NEMAŽEME data — uživatel data uvidí dál, jen pokročilé funkce
 * vrátí 402/403 v aplikační vrstvě (kontrola tier == FREE).
 */
class BillingExpiryWorker(
    private val email: EmailService?,
    private val webBaseUrl: String,
    private val intervalMillis: Long = 24L * 60 * 60 * 1000L,
) {
    private val log = LoggerFactory.getLogger(BillingExpiryWorker::class.java)

    fun start(scope: CoroutineScope) {
        scope.launch(Dispatchers.IO) {
            log.info("BillingExpiryWorker started, interval=${intervalMillis / 60_000} min.")
            // Initial 10 min delay — server po startu nech v klidu.
            delay(10 * 60 * 1000L)
            while (true) {
                runCatching { tickOnce() }.onFailure {
                    log.warn("BillingExpiryWorker tick failed: ${it.message}")
                }
                delay(intervalMillis)
            }
        }
    }

    suspend fun tickOnce(): Pair<Int, Int> {
        val reminders = sendReminders()
        val downgrades = autoDowngrade()
        log.info("Billing tick: $reminders reminders, $downgrades downgrades.")
        return reminders to downgrades
    }

    /** Pošle reminder těm, kdo expirují za 6-7 dní a ještě (nedávno) reminder nedostali. */
    private suspend fun sendReminders(): Int {
        val now = Instant.now()
        val windowStart = now.plus(6, ChronoUnit.DAYS)
        val windowEnd = now.plus(7, ChronoUnit.DAYS)
        val recentlySentCutoff = now.minus(14, ChronoUnit.DAYS)

        data class Target(val userId: UUID, val email: String, val tier: String, val expires: Instant)

        val targets = db {
            Users.selectAll().where {
                Users.tierExpiresAt.isNotNull() and
                    (Users.tier neq "FREE") and
                    Users.deletedAt.isNull() and
                    (Users.tierExpiresAt greaterEq windowStart) and
                    (Users.tierExpiresAt lessEq windowEnd) and
                    (Users.tierReminderSentAt.isNull() or (Users.tierReminderSentAt less recentlySentCutoff))
            }.map {
                Target(
                    userId = it[Users.id].value,
                    email = it[Users.email],
                    tier = it[Users.tier],
                    expires = it[Users.tierExpiresAt]!!,
                )
            }
        }

        if (targets.isEmpty() || email == null) return 0

        var sent = 0
        for (t in targets) {
            try {
                val daysLeft = Duration.between(now, t.expires).toDays().toInt().coerceAtLeast(1)
                val expiresDate = LocalDate.ofInstant(t.expires, ZoneId.systemDefault()).toString()
                val renewUrl = "$webBaseUrl/app/upgrade"
                email.send(
                    to = t.email,
                    subject = "Cointrack — předplatné vyprší za $daysLeft ${if (daysLeft == 1) "den" else "dny"}",
                    htmlBody = EmailTemplates.tierExpiryReminder(t.tier, expiresDate, daysLeft, renewUrl),
                )
                db {
                    Users.update({ Users.id eq t.userId }) {
                        it[tierReminderSentAt] = now
                    }
                }
                sent++
            } catch (e: Exception) {
                log.warn("Reminder send failed for ${t.userId}: ${e.message}")
            }
        }
        return sent
    }

    /** Najde users s expirovaným tier (>0 i past) a downgraduje je na FREE. */
    private suspend fun autoDowngrade(): Int {
        val now = Instant.now()

        data class Target(val userId: UUID, val email: String)

        val targets = db {
            Users.selectAll().where {
                Users.tierExpiresAt.isNotNull() and
                    (Users.tier neq "FREE") and
                    Users.deletedAt.isNull() and
                    (Users.tierExpiresAt less now)
            }.map {
                Target(
                    userId = it[Users.id].value,
                    email = it[Users.email],
                )
            }
        }

        if (targets.isEmpty()) return 0

        var count = 0
        for (t in targets) {
            try {
                db {
                    Users.update({ Users.id eq t.userId }) {
                        it[tier] = "FREE"
                        it[tierExpiresAt] = null
                        it[updatedAt] = now
                    }
                }
                val em = email
                if (em != null) {
                    runCatching {
                        em.send(
                            to = t.email,
                            subject = "Cointrack — přepnuto na FREE",
                            htmlBody = EmailTemplates.tierDowngradedToFree("$webBaseUrl/app/upgrade"),
                        )
                    }.onFailure { log.warn("Downgrade email send failed for ${t.userId}: ${it.message}") }
                }
                count++
                log.info("Auto-downgraded user ${t.userId} (${t.email}) → FREE")
            } catch (e: Exception) {
                log.error("Auto-downgrade failed for ${t.userId}: ${e.message}")
            }
        }
        return count
    }
}

// ─── Custom infix operators (Exposed nemá vestavěné neq/less/greaterEq/or v lambda contextu) ─

private infix fun <T> org.jetbrains.exposed.sql.Column<T>.neq(value: T) =
    org.jetbrains.exposed.sql.NeqOp(this, org.jetbrains.exposed.sql.QueryParameter(value, this.columnType))

private infix fun org.jetbrains.exposed.sql.Column<Instant?>.greaterEq(value: Instant) =
    org.jetbrains.exposed.sql.GreaterEqOp(this, org.jetbrains.exposed.sql.QueryParameter(value, this.columnType))

private infix fun org.jetbrains.exposed.sql.Column<Instant?>.lessEq(value: Instant) =
    org.jetbrains.exposed.sql.LessEqOp(this, org.jetbrains.exposed.sql.QueryParameter(value, this.columnType))

private infix fun org.jetbrains.exposed.sql.Column<Instant?>.less(value: Instant) =
    org.jetbrains.exposed.sql.LessOp(this, org.jetbrains.exposed.sql.QueryParameter(value, this.columnType))
