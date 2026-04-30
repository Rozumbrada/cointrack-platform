package cz.cointrack.fio

import cz.cointrack.db.Accounts
import cz.cointrack.db.FioCredentials
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
 * Fio Bank credentials + sync (V27).
 *
 * **Multi-credential model**: jeden profil může mít víc Fio API tokenů
 * (osobní + business + spoření...). Každý je v `fio_credentials` tabulce
 * šifrovaný AES-GCM. Mobile (FioAccounts) má 1:1 mapping přes UUID.
 *
 * Public API:
 *   - listConnections — všechna připojení profilu (bez tokenů)
 *   - createConnection / updateConnection / deleteConnection
 *   - syncConnection — sync jednoho připojení
 *   - aggregateStatus — back-compat shape pro starý /status endpoint
 *   - syncAllForProfile — back-compat: sync všech connections naráz
 *
 * Token je AES-GCM šifrovaný (klíč v IDOKLAD_ENC_KEY env).
 */
class FioService(private val client: FioClient = FioClient()) {
    private val log = LoggerFactory.getLogger(FioService::class.java)

    // ─── DTO ────────────────────────────────────────────────────────────────

    /** Status položka (per-connection — bez tokenu, jen metadata pro UI). */
    @Serializable
    data class ConnectionDto(
        val id: String,                 // UUID = match s mobilní FioAccount.syncId
        val name: String,
        val accountIban: String? = null,
        val lastSyncAt: String? = null,
        val lastMovementId: Long? = null,
    )

    /** List of connections for a profile. */
    @Serializable
    data class ConnectionsResponse(
        val connections: List<ConnectionDto>,
    )

    /** Create new connection (or upsert by id). */
    @Serializable
    data class CreateConnectionRequest(
        /** UUID = mobile FioAccount.syncId. Null = backend vygeneruje (web flow). */
        val id: String? = null,
        val name: String,
        val token: String,
    )

    /** Edit name/token; null = nezmenit. */
    @Serializable
    data class UpdateConnectionRequest(
        val name: String? = null,
        val token: String? = null,
    )

    /** Backward-compat aggregate status — true pokud má profil >= 1 connection. */
    @Serializable
    data class AggregateStatus(
        val configured: Boolean,
        val lastSyncAt: String? = null,
        val lastMovementId: Long? = null,
        val accountIban: String? = null,
    )

    /** Backward-compat shape — ProfileViewModel.pushFioCredentialsIfNeeded. */
    @Serializable
    data class SaveCredentialsRequest(
        val profileId: String,
        val token: String,
        /** Volitelné jméno pro nově vytvořenou connection (default "Fio účet"). */
        val name: String? = null,
    )

    @Serializable
    data class SyncResult(
        val added: Int,
        val skipped: Int,
        val accountIban: String? = null,
        val lastMovementId: Long? = null,
    )

    // ─── New API: per-connection CRUD ──────────────────────────────────────

    /** Vrátí všechna aktivní Fio připojení daného profilu (bez tokenů). */
    suspend fun listConnections(userId: UUID, profileSyncId: UUID): ConnectionsResponse = db {
        val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
        val rows = FioCredentials.selectAll()
            .where { (FioCredentials.profileId eq pid) and FioCredentials.deletedAt.isNull() }
            .orderBy(FioCredentials.createdAt to org.jetbrains.exposed.sql.SortOrder.ASC)
            .map { row ->
                ConnectionDto(
                    id = row[FioCredentials.id].value.toString(),
                    name = row[FioCredentials.name],
                    accountIban = row[FioCredentials.accountIban],
                    lastSyncAt = row[FioCredentials.lastSyncAt]?.toString(),
                    lastMovementId = row[FioCredentials.lastMovementId],
                )
            }
        ConnectionsResponse(connections = rows)
    }

    /**
     * Vytvoří novou connection nebo upsertuje existující podle [CreateConnectionRequest.id].
     * Pokud id == null, generuje nový UUID; jinak upsert (= insert nebo update tokenu/jména).
     */
    suspend fun createConnection(
        userId: UUID,
        profileSyncId: UUID,
        req: CreateConnectionRequest,
    ): ConnectionDto {
        val trimmed = req.token.trim()
        if (trimmed.isBlank() || trimmed.length < 20) {
            throw ApiException(
                HttpStatusCode.BadRequest, "invalid_token",
                "Fio API token vypadá příliš krátký. Vygeneruj v Fio internetbankingu → Nastavení → API.",
            )
        }
        val name = req.name.trim().ifBlank { "Fio účet" }
        val encToken = IDokladCrypto.encrypt(trimmed)
        val newId = req.id?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: UUID.randomUUID()

        return db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            val now = Instant.now()

            // Upsert: pokud existuje row s tímto id pro daný profil → update
            val existing = FioCredentials.selectAll()
                .where { (FioCredentials.id eq newId) and (FioCredentials.profileId eq pid) }
                .singleOrNull()

            if (existing != null) {
                FioCredentials.update({ FioCredentials.id eq newId }) {
                    it[FioCredentials.name] = name
                    it[tokenEnc] = encToken
                    // Reset cursor — change tokenu znamená možná nový účet → ať server stáhne celou historii
                    it[lastMovementId] = null
                    it[deletedAt] = null
                    it[updatedAt] = now
                }
            } else {
                FioCredentials.insert {
                    it[id] = EntityID(newId, FioCredentials)
                    it[FioCredentials.profileId] = EntityID(pid, Profiles)
                    it[FioCredentials.name] = name
                    it[tokenEnc] = encToken
                    it[createdAt] = now
                    it[updatedAt] = now
                }
            }

            ConnectionDto(
                id = newId.toString(),
                name = name,
                accountIban = null,
                lastSyncAt = null,
                lastMovementId = null,
            )
        }
    }

    /** Update name nebo token existujícího připojení. */
    suspend fun updateConnection(
        userId: UUID,
        credentialId: UUID,
        req: UpdateConnectionRequest,
    ): ConnectionDto = db {
        val row = credentialRowFor(userId, credentialId)
        val now = Instant.now()
        val newName = req.name?.trim()?.ifBlank { null }
        val newTokenEnc = req.token?.trim()?.let {
            if (it.length < 20) {
                throw ApiException(
                    HttpStatusCode.BadRequest, "invalid_token",
                    "Fio API token vypadá příliš krátký.",
                )
            }
            IDokladCrypto.encrypt(it)
        }

        FioCredentials.update({ FioCredentials.id eq credentialId }) {
            if (newName != null) it[FioCredentials.name] = newName
            if (newTokenEnc != null) {
                it[tokenEnc] = newTokenEnc
                it[lastMovementId] = null   // reset cursor po změně tokenu
            }
            it[updatedAt] = now
        }

        // Reload pro response
        val updated = FioCredentials.selectAll()
            .where { FioCredentials.id eq credentialId }
            .single()
        ConnectionDto(
            id = updated[FioCredentials.id].value.toString(),
            name = updated[FioCredentials.name],
            accountIban = updated[FioCredentials.accountIban],
            lastSyncAt = updated[FioCredentials.lastSyncAt]?.toString(),
            lastMovementId = updated[FioCredentials.lastMovementId],
        )
    }

    /** Soft-delete connection (token vymaže ze serveru). */
    suspend fun deleteConnection(userId: UUID, credentialId: UUID) = db {
        credentialRowFor(userId, credentialId)
        val now = Instant.now()
        FioCredentials.update({ FioCredentials.id eq credentialId }) {
            it[deletedAt] = now
            it[updatedAt] = now
            // tokenEnc nemažeme — ponecháváme zašifrované pro forenzní audit;
            // hard-delete v případě GDPR požadavku jde přes admin tooling.
        }
        Unit
    }

    /** Sync jedné konkrétní connection. */
    suspend fun syncConnection(userId: UUID, credentialId: UUID): SyncResult {
        val row = db { credentialRowFor(userId, credentialId) }
        val profileDbId = row[FioCredentials.profileId].value
        val token = decryptToken(row[FioCredentials.tokenEnc])
        val lastIdInDb = row[FioCredentials.lastMovementId]

        return runFioSync(
            profileDbId = profileDbId,
            credentialId = credentialId,
            token = token,
            lastIdInDb = lastIdInDb,
        )
    }

    // ─── Backward-compat API (pro starší klienty) ──────────────────────────

    /**
     * Aggregate status — kompatibilní s předchozí verzí endpointu.
     * `configured = true` pokud má profil >= 1 connection.
     * `lastSyncAt` = nejnovější ze všech connections.
     * `accountIban` = první connection's IBAN (deterministicky podle createdAt).
     */
    suspend fun aggregateStatus(userId: UUID, profileSyncId: UUID): AggregateStatus = db {
        val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
        val rows = FioCredentials.selectAll()
            .where { (FioCredentials.profileId eq pid) and FioCredentials.deletedAt.isNull() }
            .toList()
        if (rows.isEmpty()) {
            AggregateStatus(configured = false)
        } else {
            val firstByCreated = rows.minByOrNull { it[FioCredentials.createdAt] }!!
            val newestSync = rows.mapNotNull { it[FioCredentials.lastSyncAt] }.maxOrNull()
            AggregateStatus(
                configured = true,
                accountIban = firstByCreated[FioCredentials.accountIban],
                lastSyncAt = newestSync?.toString(),
                lastMovementId = firstByCreated[FioCredentials.lastMovementId],
            )
        }
    }

    /**
     * Backward-compat: PUT /api/v1/fio/credentials. Vytvoří nebo nahradí PRVNÍ
     * connection daného profilu (= mobile pushFioCredentialsIfNeeded flow).
     */
    suspend fun saveCredentials(userId: UUID, req: SaveCredentialsRequest): ConnectionDto {
        val profileSyncId = UUID.fromString(req.profileId)
        // Najdi existující connection s default name "Fio účet" nebo nejstarší v profilu
        val existingId = db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            FioCredentials.selectAll()
                .where { (FioCredentials.profileId eq pid) and FioCredentials.deletedAt.isNull() }
                .orderBy(FioCredentials.createdAt to org.jetbrains.exposed.sql.SortOrder.ASC)
                .firstOrNull()
                ?.get(FioCredentials.id)
                ?.value
                ?.toString()
        }
        return createConnection(
            userId = userId,
            profileSyncId = profileSyncId,
            req = CreateConnectionRequest(
                id = existingId,                       // upsert do první connection
                name = req.name ?: "Fio účet",
                token = req.token,
            ),
        )
    }

    /** Backward-compat: smaže VŠECHNY connections daného profilu. */
    suspend fun clearCredentials(userId: UUID, profileSyncId: UUID) = db {
        val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
        val now = Instant.now()
        FioCredentials.update({
            (FioCredentials.profileId eq pid) and FioCredentials.deletedAt.isNull()
        }) {
            it[deletedAt] = now
            it[updatedAt] = now
        }
        Unit
    }

    /** Backward-compat: sync VŠECHNY connections daného profilu (sequential). */
    suspend fun syncAllForProfile(userId: UUID, profileSyncId: UUID): SyncResult {
        val ids: List<UUID> = db {
            val pid = profileRowFor(userId, profileSyncId)[Profiles.id].value
            FioCredentials.selectAll()
                .where { (FioCredentials.profileId eq pid) and FioCredentials.deletedAt.isNull() }
                .map { it[FioCredentials.id].value }
        }
        if (ids.isEmpty()) {
            throw ApiException(
                HttpStatusCode.BadRequest, "no_token",
                "Profil nemá žádné Fio připojení. Přidej ho v menu profilu.",
            )
        }
        var totalAdded = 0
        var totalSkipped = 0
        var lastIban: String? = null
        var lastMovId: Long? = null
        for (id in ids) {
            val r = runCatching { syncConnection(userId, id) }
                .onFailure { e -> log.warn("Fio sync connection $id selhal: ${e.message}") }
                .getOrNull() ?: continue
            totalAdded += r.added
            totalSkipped += r.skipped
            if (r.accountIban != null) lastIban = r.accountIban
            if (r.lastMovementId != null) lastMovId = r.lastMovementId
        }
        return SyncResult(
            added = totalAdded,
            skipped = totalSkipped,
            accountIban = lastIban,
            lastMovementId = lastMovId,
        )
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    private fun decryptToken(encToken: String): String =
        runCatching { IDokladCrypto.decrypt(encToken) }
            .getOrElse {
                throw ApiException(
                    HttpStatusCode.InternalServerError, "decrypt_failed",
                    "Nelze dešifrovat token. Možná byl změněn IDOKLAD_ENC_KEY — ulož token znovu.",
                )
            }

    /**
     * Stáhne nové transakce z Fio API (od `last_movement_id`) a uloží je
     * do hlavního `transactions` tabulky. Auto-discovers Account podle IBAN.
     * Aktualizuje cursor + last_sync_at na fio_credentials řádku.
     */
    private suspend fun runFioSync(
        profileDbId: UUID,
        credentialId: UUID,
        token: String,
        lastIdInDb: Long?,
    ): SyncResult {
        val statement = try {
            if (lastIdInDb == null) {
                client.setLastId(token, 0L)
            }
            client.fetchLast(token)
        } catch (e: FioException) {
            // Log Fio chybu detailně — `e.message` jinak browser nevidí, protože
            // CORS hlavičky chybí na error responses (TODO: opravit globálně).
            log.warn(
                "Fio API rejection při syncu credential={}, profile={}: {}",
                credentialId, profileDbId, e.message, e,
            )
            throw ApiException(
                HttpStatusCode.BadGateway, "fio_api_failed",
                "Fio API odmítl požadavek: ${e.message}",
            )
        } catch (e: Exception) {
            // Cokoliv jiného — taky logni, ať vidíme v produkci co se stalo.
            log.error(
                "Fio sync neočekávaná chyba pro credential={}, profile={}: {}",
                credentialId, profileDbId, e.message, e,
            )
            throw e
        }

        val info = statement.accountStatement.info
        val txs = statement.accountStatement.transactionList.transaction

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
                    it[Transactions.amount] = amount
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

        // Update cursor + IBAN + last sync na credential řádku
        db {
            FioCredentials.update({ FioCredentials.id eq credentialId }) {
                it[lastMovementId] = maxMovementId
                it[lastSyncAt] = Instant.now()
                if (info.iban != null) it[accountIban] = info.iban
                it[updatedAt] = Instant.now()
            }
        }

        // Set cursor i ve Fio API
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
            throw ApiException(
                HttpStatusCode.Forbidden, "not_profile_owner",
                "Profil nepatří přihlášenému uživateli.",
            )
        }
        return row
    }

    /** Najde fio_credentials řádek a ověří, že patří profilu, který vlastní user. */
    private fun credentialRowFor(userId: UUID, credentialId: UUID): org.jetbrains.exposed.sql.ResultRow {
        val row = FioCredentials.selectAll()
            .where { (FioCredentials.id eq credentialId) and FioCredentials.deletedAt.isNull() }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "credential_not_found", "Fio připojení nenalezeno.")
        val profileRow = Profiles.selectAll()
            .where { Profiles.id eq row[FioCredentials.profileId] }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil připojení nenalezen.")
        if (profileRow[Profiles.ownerUserId].value != userId) {
            throw ApiException(
                HttpStatusCode.Forbidden, "not_owner",
                "Fio připojení nepatří přihlášenému uživateli.",
            )
        }
        return row
    }
}
