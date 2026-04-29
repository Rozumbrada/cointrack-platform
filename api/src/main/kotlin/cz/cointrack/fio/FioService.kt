package cz.cointrack.fio

import cz.cointrack.db.Accounts
import cz.cointrack.db.Profiles
import cz.cointrack.db.Transactions
import cz.cointrack.db.db
import cz.cointrack.idoklad.IDokladCrypto
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Fio Bank credentials + sync (V26). Token je uložen šifrovaně (AES-GCM)
 * a server volá Fio API pro stažení transakcí. Tx se pak ukládají do
 * `transactions` table a klienti je dostanou přes /sync flow.
 *
 * Auto-discovery účtu: pokud profil ještě nemá Account s odpovídajícím
 * IBAN/account number z Fio response, vytvoříme nový Account typu BANK
 * (klient ho dostane přes /sync). Pokud má, použijeme existing.
 */
class FioService(private val client: FioClient = FioClient()) {
    private val log = LoggerFactory.getLogger(FioService::class.java)

    @Serializable
    data class Status(
        val configured: Boolean,
        val lastSyncAt: String? = null,
        val lastMovementId: Long? = null,
        val accountIban: String? = null,
    )

    @Serializable
    data class SaveCredentialsRequest(
        val profileId: String,
        val token: String,
    )

    @Serializable
    data class SyncResult(
        val added: Int,
        val skipped: Int,
        val accountIban: String? = null,
        val lastMovementId: Long? = null,
    )

    /** Status Fio připojení pro daný profil. */
    suspend fun status(userId: UUID, profileSyncId: UUID): Status = db {
        val row = profileRowFor(userId, profileSyncId)
        val pid = row[Profiles.id].value
        // IBAN z auto-discovered accountu (pokud sync proběhl)
        val iban = Accounts.selectAll()
            .where {
                (Accounts.profileId eq pid) and
                    (Accounts.bankProvider eq "fio") and
                    Accounts.deletedAt.isNull()
            }
            .map { it[Accounts.bankIban] }
            .firstOrNull()
        Status(
            configured = !row[Profiles.fioTokenEnc].isNullOrBlank(),
            lastSyncAt = row[Profiles.fioLastSyncAt]?.toString(),
            lastMovementId = row[Profiles.fioLastMovementId],
            accountIban = iban,
        )
    }

    /** Uloží Fio API token (AES-GCM šifrovaný). */
    suspend fun saveCredentials(userId: UUID, req: SaveCredentialsRequest) {
        val profileSyncId = UUID.fromString(req.profileId)
        val trimmed = req.token.trim()
        if (trimmed.isBlank() || trimmed.length < 20) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_token",
                "Fio API token vypadá příliš krátký. Vygeneruj v Fio internetbankingu → Nastavení → API.")
        }
        val encToken = IDokladCrypto.encrypt(trimmed)
        db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            Profiles.update({ Profiles.id eq pid }) {
                it[fioTokenEnc] = encToken
                // Reset cursor — first sync stáhne celou historii
                it[fioLastMovementId] = null
            }
        }
    }

    /** Smaže credentials. */
    suspend fun clearCredentials(userId: UUID, profileSyncId: UUID) {
        db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            Profiles.update({ Profiles.id eq pid }) {
                it[fioTokenEnc] = null
                it[fioLastSyncAt] = null
                it[fioLastMovementId] = null
            }
        }
    }

    /**
     * Stáhne nové transakce z Fio API (od `fio_last_movement_id`) a uloží je.
     * - První sync: stáhne podle `set-last-id` 0 → vše dosud (Fio limit ~ 90 dní zpět).
     * - Další sync: jen incrementální od posledního ID.
     * Auto-discovers Account podle IBAN.
     */
    suspend fun sync(userId: UUID, profileSyncId: UUID): SyncResult {
        val (profileDbId, token, lastIdInDb) = db {
            val row = profileRowFor(userId, profileSyncId)
            val enc = row[Profiles.fioTokenEnc]
                ?: throw ApiException(HttpStatusCode.BadRequest, "no_token",
                    "Není uložen Fio token. Vyplň ho v menu profilu.")
            val plainToken = runCatching { IDokladCrypto.decrypt(enc) }
                .getOrElse {
                    throw ApiException(HttpStatusCode.InternalServerError, "decrypt_failed",
                        "Nelze dešifrovat token. Možná byl změněn IDOKLAD_ENC_KEY — ulož token znovu.")
                }
            Triple(row[Profiles.id].value, plainToken, row[Profiles.fioLastMovementId])
        }

        // Pokud user nikdy nesynchronizoval, set-last-id na 0 stáhne vše dostupné.
        // Pokud máme last ID, fetchLast vrátí jen tx > tomu ID (= server-side dedup).
        val statement = try {
            if (lastIdInDb == null) {
                client.setLastId(token, 0L)
            }
            client.fetchLast(token)
        } catch (e: FioException) {
            throw ApiException(HttpStatusCode.BadGateway, "fio_api_failed",
                "Fio API odmítl požadavek: ${e.message}")
        }

        val info = statement.accountStatement.info
        val txs = statement.accountStatement.transactionList.transaction

        // Auto-discover / find Account
        val accountDbId = ensureFioAccount(profileDbId, info)

        var added = 0
        var skipped = 0
        var maxMovementId = lastIdInDb ?: 0L

        for (tx in txs) {
            val movementId = tx.movementId?.value ?: continue
            if (movementId > maxMovementId) maxMovementId = movementId

            val amount = tx.amount?.value?.let { BigDecimal.valueOf(it).setScale(2, RoundingMode.HALF_UP) }
                ?: continue
            val date = tx.date?.value?.let {
                runCatching { LocalDate.parse(it.take(10)) }.getOrNull()
            } ?: continue

            // Dedup podle (profile, bankTxId)
            val bankTxIdStr = movementId.toString()
            val existing = db {
                Transactions.selectAll()
                    .where {
                        (Transactions.profileId eq profileDbId) and
                            (Transactions.bankTxId eq bankTxIdStr)
                    }
                    .singleOrNull()
            }
            if (existing != null) {
                skipped++
                continue
            }

            db {
                Transactions.insert {
                    it[syncId] = UUID.randomUUID()
                    it[Transactions.profileId] = EntityID(profileDbId, Profiles)
                    it[Transactions.accountId] = EntityID(accountDbId, Accounts)
                    it[Transactions.amount] = amount  // signed: + příjem, - výdaj (Fio už dává signed)
                    it[Transactions.currency] = tx.currency?.value ?: info.currency ?: "CZK"
                    it[Transactions.description] = tx.note?.value
                    it[Transactions.merchant] = tx.counterAccountName?.value
                    it[Transactions.date] = date
                    it[Transactions.bankTxId] = bankTxIdStr
                    it[Transactions.bankVs] = tx.varSymbol?.value
                    it[Transactions.bankCounterparty] = tx.counterAccount?.value
                    it[Transactions.bankCounterpartyName] = tx.counterAccountName?.value
                    it[Transactions.isTransfer] = false
                    it[clientVersion] = 1
                    it[updatedAt] = Instant.now()
                }
            }
            added++
        }

        // Update cursor + last sync time
        db {
            Profiles.update({ Profiles.id eq profileDbId }) {
                it[fioLastMovementId] = maxMovementId
                it[fioLastSyncAt] = Instant.now()
            }
        }

        // Set cursor i ve Fio API (= další fetchLast vrátí jen new ones)
        try {
            client.setLastId(token, maxMovementId)
        } catch (e: FioException) {
            log.warn("Fio set-last-id selhalo: ${e.message} (sync byl OK, jen cursor není v Fio updated)")
        }

        return SyncResult(
            added = added,
            skipped = skipped,
            accountIban = info.iban,
            lastMovementId = maxMovementId,
        )
    }

    /**
     * Najdi nebo vytvoř Account pro daný IBAN (auto-discovery).
     * Profil dostane účet typu BANK s `bank_provider = 'fio'`. Klient (web/mobile)
     * ho dostane přes hlavní /sync flow.
     */
    private suspend fun ensureFioAccount(profileDbId: UUID, info: FioClient.AccountInfo): UUID = db {
        // 1) najít existing podle IBAN
        if (!info.iban.isNullOrBlank()) {
            val existing = Accounts.selectAll()
                .where {
                    (Accounts.profileId eq profileDbId) and
                        (Accounts.bankIban eq info.iban) and
                        Accounts.deletedAt.isNull()
                }
                .singleOrNull()
            if (existing != null) return@db existing[Accounts.id].value
        }

        // 2) najít existing podle account number + bank code
        if (!info.accountId.isNullOrBlank() && !info.bankId.isNullOrBlank()) {
            val existing = Accounts.selectAll()
                .where {
                    (Accounts.profileId eq profileDbId) and
                        (Accounts.bankAccountNumber eq info.accountId) and
                        (Accounts.bankCode eq info.bankId) and
                        Accounts.deletedAt.isNull()
                }
                .singleOrNull()
            if (existing != null) return@db existing[Accounts.id].value
        }

        // 3) vytvoř nový (auto-discover)
        val newId = Accounts.insert {
            it[syncId] = UUID.randomUUID()
            it[Accounts.profileId] = EntityID(profileDbId, Profiles)
            it[Accounts.name] = "Fio (${info.iban?.takeLast(8) ?: info.accountId ?: "?"})"
            it[Accounts.type] = "BANK"
            it[Accounts.currency] = info.currency ?: "CZK"
            it[Accounts.initialBalance] =
                info.openingBalance?.let { v -> BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP) }
                    ?: BigDecimal.ZERO
            it[Accounts.bankProvider] = "fio"
            it[Accounts.bankIban] = info.iban
            it[Accounts.bankAccountNumber] = info.accountId
            it[Accounts.bankCode] = info.bankId
            it[clientVersion] = 1
            it[updatedAt] = Instant.now()
        } get Accounts.id
        log.info("Auto-vytvořen Fio Account pro profil $profileDbId, IBAN ${info.iban}")
        newId.value
    }

    private fun profileRowFor(userId: UUID, profileSyncId: UUID): org.jetbrains.exposed.sql.ResultRow {
        val row = Profiles.selectAll().where { Profiles.syncId eq profileSyncId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
        if (row[Profiles.ownerUserId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "not_profile_owner",
                "Profil nepatří přihlášenému uživateli.")
        }
        return row
    }
}
