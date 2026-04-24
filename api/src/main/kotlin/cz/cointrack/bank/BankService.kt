package cz.cointrack.bank

import cz.cointrack.db.BankAccountProfileAssignments
import cz.cointrack.db.BankAccountsExt
import cz.cointrack.db.BankConnections
import cz.cointrack.db.BankCustomers
import cz.cointrack.db.BankTransactionsExt
import cz.cointrack.db.BankWebhookEvents
import cz.cointrack.db.Profiles
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

private val log = LoggerFactory.getLogger(BankService::class.java)

class BankService(
    private val bankingProvider: BankingProvider,
    private val returnUrl: String,
) {
    /** Shortcut pro použití v DB closures, kde symbol `provider` koliduje s Exposed DSL. */
    private val providerId: String = bankingProvider.id


    /**
     * Vytvoří nebo vrátí existujícího external customer-a pro user-a.
     */
    suspend fun ensureCustomer(userId: UUID): String {
        // 1. Zkus najít
        val existing = db {
            BankCustomers
                .selectAll()
                .where {
                    (BankCustomers.userId eq userId) and
                        (BankCustomers.provider eq providerId)
                }
                .singleOrNull()
                ?.get(BankCustomers.externalId)
        }
        if (existing != null) return existing

        // 2. Vytvoř u provider-a
        val email = db {
            Users.selectAll().where { Users.id eq userId }.singleOrNull()
                ?.get(Users.email)
        }
        val externalId = bankingProvider.createCustomer(userId.toString(), email)

        // 3. Ulož mapping
        db {
            BankCustomers.insertAndGetId {
                it[BankCustomers.userId] = userId
                it[BankCustomers.provider] = providerId
                it[BankCustomers.externalId] = externalId
                it[BankCustomers.createdAt] = Instant.now()
            }
        }
        return externalId
    }

    /**
     * Vytvoří connect session — vrátí klientovi URL, kam ho má přesměrovat (WebView).
     */
    suspend fun createConnectSession(userId: UUID, req: ConnectSessionRequest): ConnectSessionResponse {
        val externalCustomerId = ensureCustomer(userId)
        val payload = bankingProvider.createConnectSession(
            externalCustomerId = externalCustomerId,
            providerCode = req.providerCode,
            locale = req.locale,
            returnUrl = returnUrl,
        )
        return ConnectSessionResponse(
            connectUrl = payload.url,
            expiresAt = payload.expiresAt.toString(),
        )
    }

    /**
     * Vrátí připojené banky + jejich účty. Pokud connection status != active,
     * označí v UI jako vyžadující obnovu.
     */
    suspend fun listConnections(userId: UUID): List<BankConnectionDto> {
        return db {
            val customerRow = BankCustomers
                .selectAll()
                .where {
                    (BankCustomers.userId eq userId) and
                        (BankCustomers.provider eq providerId)
                }
                .singleOrNull()
                ?: return@db emptyList()

            val connections = BankConnections
                .selectAll()
                .where {
                    (BankConnections.customerId eq customerRow[BankCustomers.id]) and
                        (BankConnections.deletedAt.isNull())
                }
                .orderBy(BankConnections.createdAt, SortOrder.DESC)
                .toList()

            // Načti všechna přiřazení tohoto user-a (přes všechny účty v jeho connections)
            val allConnIds = connections.map { it[BankConnections.id].value }
            val allAccountIds = if (allConnIds.isEmpty()) emptyList() else
                BankAccountsExt.selectAll()
                    .where { BankAccountsExt.connectionId inList allConnIds }
                    .map { it[BankAccountsExt.id].value }
            val assignmentsByAccount: Map<UUID, List<Pair<UUID, Boolean>>> =
                if (allAccountIds.isEmpty()) emptyMap()
                else BankAccountProfileAssignments.selectAll()
                    .where { BankAccountProfileAssignments.bankAccountExtId inList allAccountIds }
                    .groupBy { it[BankAccountProfileAssignments.bankAccountExtId].value }
                    .mapValues { (_, rows) ->
                        rows.map {
                            it[BankAccountProfileAssignments.profileId] to
                                it[BankAccountProfileAssignments.autoImport]
                        }
                    }

            connections.map { c ->
                val connUuid = c[BankConnections.id].value
                val accounts = BankAccountsExt
                    .selectAll()
                    .where {
                        (BankAccountsExt.connectionId eq connUuid) and
                            (BankAccountsExt.deletedAt.isNull())
                    }
                    .map { a ->
                        val accId = a[BankAccountsExt.id].value
                        val assignments = assignmentsByAccount[accId] ?: emptyList()
                        BankAccountExtDto(
                            id = accId.toString(),
                            name = a[BankAccountsExt.name],
                            nature = a[BankAccountsExt.nature],
                            currencyCode = a[BankAccountsExt.currencyCode],
                            iban = a[BankAccountsExt.iban],
                            accountNumber = a[BankAccountsExt.accountNumber],
                            balance = a[BankAccountsExt.balance]?.toPlainString(),
                            balanceUpdatedAt = a[BankAccountsExt.balanceUpdatedAt]?.toString(),
                            assignedProfileIds = assignments.map { it.first.toString() },
                            autoImportProfileIds = assignments.filter { it.second }.map { it.first.toString() },
                        )
                    }
                BankConnectionDto(
                    id = connUuid.toString(),
                    providerCode = c[BankConnections.providerCode],
                    providerName = c[BankConnections.providerName],
                    status = c[BankConnections.status],
                    lastSuccessAt = c[BankConnections.lastSuccessAt]?.toString(),
                    consentExpiresAt = c[BankConnections.consentExpiresAt]?.toString(),
                    lastError = c[BankConnections.lastError],
                    accounts = accounts,
                )
            }
        }
    }

    /**
     * Reconnect — uživatel potřebuje obnovit consent pro existující připojení.
     * Vrátí connect_url, kam ho klient má přesměrovat (WebView).
     */
    suspend fun reconnectSession(
        userId: UUID,
        connectionId: UUID,
        locale: String = "cs",
    ): ConnectSessionResponse {
        val externalId = db {
            val c = BankConnections.selectAll()
                .where { BankConnections.id eq connectionId }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "connection_not_found", "Připojení neexistuje.")
            val customer = BankCustomers.selectAll()
                .where { BankCustomers.id eq c[BankConnections.customerId] }
                .single()
            if (customer[BankCustomers.userId].value != userId) {
                throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není vaše připojení.")
            }
            c[BankConnections.externalId]
        }
        val payload = bankingProvider.reconnectSession(externalId, locale, returnUrl)
        return ConnectSessionResponse(
            connectUrl = payload.url,
            expiresAt = payload.expiresAt.toString(),
        )
    }

    /**
     * Smaže connection (u provider-a i lokálně). Transakce a účty zůstanou — uživatel je
     * už stáhl a může je používat offline. Soft delete přes deleted_at.
     */
    suspend fun deleteConnection(userId: UUID, connectionId: UUID) {
        val externalId = db {
            val c = BankConnections
                .selectAll()
                .where { BankConnections.id eq connectionId }
                .singleOrNull() ?: throw ApiException(
                HttpStatusCode.NotFound, "connection_not_found", "Připojení neexistuje."
            )
            // Ověř vlastnictví
            val customer = BankCustomers
                .selectAll()
                .where { BankCustomers.id eq c[BankConnections.customerId] }
                .single()
            if (customer[BankCustomers.userId].value != userId) {
                throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není vaše připojení.")
            }
            c[BankConnections.externalId]
        }

        runCatching { bankingProvider.removeConnection(externalId) }
            .onFailure { log.warn("Provider removeConnection selhal: ${it.message}") }

        db {
            BankConnections.update({ BankConnections.id eq connectionId }) {
                it[BankConnections.deletedAt] = Instant.now()
                it[BankConnections.updatedAt] = Instant.now()
                it[BankConnections.status] = "disabled"
            }
        }
    }

    /**
     * Vrátí transakce daného účtu seřazené od nejnovější. Ověřuje, že účet patří
     * user-ovi (přes connection → customer → user).
     */
    suspend fun listTransactions(
        userId: UUID,
        accountExtId: UUID,
        limit: Int = 100,
    ): List<BankTransactionExtDto> = db {
        val account = BankAccountsExt.selectAll()
            .where { BankAccountsExt.id eq accountExtId }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found", "Účet neexistuje.")

        val connection = BankConnections.selectAll()
            .where { BankConnections.id eq account[BankAccountsExt.connectionId] }
            .single()
        val customer = BankCustomers.selectAll()
            .where { BankCustomers.id eq connection[BankConnections.customerId] }
            .single()
        // Pozor: BankCustomers.userId je Column<EntityID<UUID>>, dostaneme EntityID<UUID>.
        // Pro porovnání s čistým UUID použít .value.
        if (customer[BankCustomers.userId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není váš účet.")
        }

        BankTransactionsExt.selectAll()
            .where { BankTransactionsExt.accountExtId eq accountExtId }
            .orderBy(BankTransactionsExt.madeOn, SortOrder.DESC)
            .limit(limit)
            .map { t ->
                BankTransactionExtDto(
                    id = t[BankTransactionsExt.id].value.toString(),
                    accountId = accountExtId.toString(),
                    amount = t[BankTransactionsExt.amount].toPlainString(),
                    currencyCode = t[BankTransactionsExt.currencyCode],
                    description = t[BankTransactionsExt.description],
                    madeOn = t[BankTransactionsExt.madeOn].toString(),
                    merchantName = t[BankTransactionsExt.merchantName],
                    status = t[BankTransactionsExt.status],
                )
            }
    }

    // ─── Bank account ↔ profile assignment (Sprint 8) ──────────────────

    /** Seznam přiřazení pro user-a: které bank účty patří kterým profilům. */
    suspend fun listAssignments(userId: UUID): List<BankAssignmentDto> = db {
        // Přes všechny user-ovi profily
        val userProfileIds = Profiles
            .selectAll()
            .where { (Profiles.ownerUserId eq userId) and (Profiles.deletedAt.isNull()) }
            .map { it[Profiles.id].value }

        if (userProfileIds.isEmpty()) return@db emptyList()

        BankAccountProfileAssignments
            .selectAll()
            .where { BankAccountProfileAssignments.profileId inList userProfileIds }
            .orderBy(BankAccountProfileAssignments.createdAt, SortOrder.DESC)
            .map { row ->
                BankAssignmentDto(
                    id = row[BankAccountProfileAssignments.id].value.toString(),
                    bankAccountExtId = row[BankAccountProfileAssignments.bankAccountExtId].value.toString(),
                    profileId = row[BankAccountProfileAssignments.profileId].toString(),
                    autoImport = row[BankAccountProfileAssignments.autoImport],
                    createdAt = row[BankAccountProfileAssignments.createdAt].toString(),
                )
            }
    }

    /**
     * Přiřadí bankovní účet k profilu. Ověří, že:
     *  - bank účet patří user-ovi (přes connection → customer → user)
     *  - profil taky patří user-ovi
     */
    suspend fun assignAccountToProfile(
        userId: UUID,
        accountExtId: UUID,
        profileSyncId: UUID,
        autoImport: Boolean,
    ): BankAssignmentDto = db {
        // 1. Bank account ownership
        val acc = BankAccountsExt
            .selectAll()
            .where { BankAccountsExt.id eq accountExtId }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found", "Účet neexistuje.")
        val conn = BankConnections
            .selectAll()
            .where { BankConnections.id eq acc[BankAccountsExt.connectionId] }
            .single()
        val customer = BankCustomers
            .selectAll()
            .where { BankCustomers.id eq conn[BankConnections.customerId] }
            .single()
        if (customer[BankCustomers.userId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není váš účet.")
        }

        // 2. Profile ownership
        val profile = Profiles
            .selectAll()
            .where { Profiles.id eq profileSyncId }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil neexistuje.")
        if (profile[Profiles.ownerUserId].value != userId) {
            throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není váš profil.")
        }

        // 3. Upsert assignment
        val existing = BankAccountProfileAssignments
            .selectAll()
            .where {
                (BankAccountProfileAssignments.bankAccountExtId eq accountExtId) and
                    (BankAccountProfileAssignments.profileId eq profileSyncId)
            }
            .singleOrNull()

        val assignmentId = if (existing != null) {
            BankAccountProfileAssignments.update({
                BankAccountProfileAssignments.id eq existing[BankAccountProfileAssignments.id]
            }) {
                it[BankAccountProfileAssignments.autoImport] = autoImport
            }
            existing[BankAccountProfileAssignments.id].value
        } else {
            BankAccountProfileAssignments.insertAndGetId {
                it[BankAccountProfileAssignments.bankAccountExtId] = accountExtId
                it[BankAccountProfileAssignments.profileId] = profileSyncId
                it[BankAccountProfileAssignments.autoImport] = autoImport
                it[BankAccountProfileAssignments.createdAt] = Instant.now()
            }.value
        }

        BankAssignmentDto(
            id = assignmentId.toString(),
            bankAccountExtId = accountExtId.toString(),
            profileId = profileSyncId.toString(),
            autoImport = autoImport,
            createdAt = Instant.now().toString(),
        )
    }

    /** Smaže přiřazení (soft delete přes hard delete OK — uživatel může znovu vytvořit). */
    suspend fun unassignAccountFromProfile(
        userId: UUID,
        accountExtId: UUID,
        profileSyncId: UUID,
    ) {
        // Ověř ownership přes existující listAssignments path
        val ownsProfile = db {
            Profiles.selectAll()
                .where { (Profiles.id eq profileSyncId) and (Profiles.ownerUserId eq userId) }
                .any()
        }
        if (!ownsProfile) {
            throw ApiException(HttpStatusCode.Forbidden, "forbidden", "Není váš profil.")
        }
        db {
            BankAccountProfileAssignments.deleteWhere {
                (bankAccountExtId eq accountExtId) and (profileId eq profileSyncId)
            }
        }
    }

    /** Pomocné — dohledá external ID pro lokální connection UUID. */
    suspend fun findExternalConnectionId(connectionId: UUID): String = db {
        BankConnections
            .selectAll()
            .where { BankConnections.id eq connectionId }
            .singleOrNull()
            ?.get(BankConnections.externalId)
            ?: throw ApiException(HttpStatusCode.NotFound, "connection_not_found", "Připojení neexistuje.")
    }

    // ─── Webhook ingest ────────────────────────────────────────────────

    /**
     * Uloží webhook event + zpracuje (upsert connection, stáhne accounts+transactions).
     * Vrátí true, pokud payload byl validní.
     */
    suspend fun ingestWebhook(rawBody: String, signature: String?): Boolean {
        val json = try {
            Json.parseToJsonElement(rawBody).jsonObject
        } catch (_: Exception) {
            log.warn("Webhook: nelze parsovat JSON")
            return false
        }

        // Log eventu
        val data = json["data"] as? JsonObject
        val eventType = (json["meta"] as? JsonObject)?.get("version")?.jsonPrimitive?.contentOrNull
            ?: json["notification_type"]?.jsonPrimitive?.contentOrNull
            ?: "unknown"
        val externalConnectionId = data?.get("connection_id")?.jsonPrimitive?.contentOrNull
            ?: data?.get("connection")?.let { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull }

        val eventId = db {
            BankWebhookEvents.insertAndGetId {
                it[BankWebhookEvents.provider] = providerId
                it[BankWebhookEvents.eventType] = eventType
                it[BankWebhookEvents.externalConnectionId] = externalConnectionId
                it[BankWebhookEvents.payload] = rawBody
                it[BankWebhookEvents.signature] = signature
                it[BankWebhookEvents.receivedAt] = Instant.now()
            }.value
        }

        if (externalConnectionId == null) {
            db {
                BankWebhookEvents.update({ BankWebhookEvents.id eq eventId }) {
                    it[BankWebhookEvents.processedAt] = Instant.now()
                    it[BankWebhookEvents.error] = "no_connection_id"
                }
            }
            return true
        }

        try {
            refreshConnection(externalConnectionId)
            db {
                BankWebhookEvents.update({ BankWebhookEvents.id eq eventId }) {
                    it[BankWebhookEvents.processedAt] = Instant.now()
                }
            }
        } catch (e: Exception) {
            log.error("Webhook processing selhal", e)
            db {
                BankWebhookEvents.update({ BankWebhookEvents.id eq eventId }) {
                    it[BankWebhookEvents.processedAt] = Instant.now()
                    it[BankWebhookEvents.error] = e.message?.take(1000)
                }
            }
        }
        return true
    }

    /**
     * Refresh jedné connection — načte status, accounts, new transactions z provider-a
     * a uloží do DB. Volané z webhooku a manuálně.
     */
    suspend fun refreshConnection(externalConnectionId: String) {
        val conn = bankingProvider.fetchConnection(externalConnectionId)

        // Najdi nebo vytvoř lokální záznam
        val (connUuid, customerUuid) = db {
            val existing = BankConnections.selectAll().where {
                (BankConnections.provider eq providerId) and
                    (BankConnections.externalId eq externalConnectionId)
            }.singleOrNull()

            if (existing != null) {
                BankConnections.update({ BankConnections.id eq existing[BankConnections.id] }) {
                    it[BankConnections.status] = conn.status
                    it[BankConnections.providerCode] = conn.providerCode
                    it[BankConnections.providerName] = conn.providerName
                    it[BankConnections.lastSuccessAt] = conn.lastSuccessAt
                    it[BankConnections.consentExpiresAt] = conn.consentExpiresAt
                    it[BankConnections.lastError] = conn.lastError
                    it[BankConnections.updatedAt] = Instant.now()
                }
                existing[BankConnections.id].value to existing[BankConnections.customerId].value
            } else {
                // Nový connection — potřebujeme zjistit customer_id z raw payloadu
                val customerExternalId = (conn.raw as? JsonObject)
                    ?.get("customer_id")?.jsonPrimitive?.contentOrNull
                    ?: error("Salt Edge connection $externalConnectionId bez customer_id")
                val customerRow = BankCustomers.selectAll().where {
                    (BankCustomers.provider eq providerId) and
                        (BankCustomers.externalId eq customerExternalId)
                }.singleOrNull() ?: error("Customer $customerExternalId nemá lokální záznam")
                val newId = BankConnections.insertAndGetId {
                    it[BankConnections.customerId] = customerRow[BankCustomers.id]
                    it[BankConnections.provider] = providerId
                    it[BankConnections.externalId] = externalConnectionId
                    it[BankConnections.providerCode] = conn.providerCode
                    it[BankConnections.providerName] = conn.providerName
                    it[BankConnections.status] = conn.status
                    it[BankConnections.lastSuccessAt] = conn.lastSuccessAt
                    it[BankConnections.consentExpiresAt] = conn.consentExpiresAt
                    it[BankConnections.lastError] = conn.lastError
                    it[BankConnections.createdAt] = Instant.now()
                    it[BankConnections.updatedAt] = Instant.now()
                }.value
                newId to customerRow[BankCustomers.id].value
            }
        }

        // Stáhni účty
        val accounts = bankingProvider.fetchAccounts(externalConnectionId)
        val accountIdMap = mutableMapOf<String, UUID>()
        db {
            accounts.forEach { a ->
                val existing = BankAccountsExt.selectAll().where {
                    (BankAccountsExt.connectionId eq connUuid) and
                        (BankAccountsExt.externalId eq a.externalId)
                }.singleOrNull()
                val id = if (existing != null) {
                    BankAccountsExt.update({ BankAccountsExt.id eq existing[BankAccountsExt.id] }) {
                        it[BankAccountsExt.name] = a.name
                        it[BankAccountsExt.nature] = a.nature
                        it[BankAccountsExt.currencyCode] = a.currencyCode
                        it[BankAccountsExt.iban] = a.iban
                        it[BankAccountsExt.accountNumber] = a.accountNumber
                        it[BankAccountsExt.balance] = a.balance
                        it[BankAccountsExt.balanceUpdatedAt] = a.balanceUpdatedAt
                        it[BankAccountsExt.raw] = a.raw.toString()
                        it[BankAccountsExt.updatedAt] = Instant.now()
                    }
                    existing[BankAccountsExt.id].value
                } else {
                    BankAccountsExt.insertAndGetId {
                        it[BankAccountsExt.connectionId] = connUuid
                        it[BankAccountsExt.externalId] = a.externalId
                        it[BankAccountsExt.name] = a.name
                        it[BankAccountsExt.nature] = a.nature
                        it[BankAccountsExt.currencyCode] = a.currencyCode
                        it[BankAccountsExt.iban] = a.iban
                        it[BankAccountsExt.accountNumber] = a.accountNumber
                        it[BankAccountsExt.balance] = a.balance
                        it[BankAccountsExt.balanceUpdatedAt] = a.balanceUpdatedAt
                        it[BankAccountsExt.raw] = a.raw.toString()
                        it[BankAccountsExt.createdAt] = Instant.now()
                        it[BankAccountsExt.updatedAt] = Instant.now()
                    }.value
                }
                accountIdMap[a.externalId] = id
            }
        }

        // Stáhni transakce pro každý účet, dedup přes unique (account_ext_id, external_id)
        accountIdMap.forEach { (externalAccId, localAccId) ->
            val txs = bankingProvider.fetchTransactions(externalConnectionId, externalAccId)
            if (txs.isEmpty()) return@forEach
            db {
                txs.forEach { t ->
                    val exists = BankTransactionsExt.selectAll().where {
                        (BankTransactionsExt.accountExtId eq localAccId) and
                            (BankTransactionsExt.externalId eq t.externalId)
                    }.limit(1).any()
                    if (!exists) {
                        BankTransactionsExt.insertAndGetId {
                            it[BankTransactionsExt.accountExtId] = localAccId
                            it[BankTransactionsExt.externalId] = t.externalId
                            it[BankTransactionsExt.amount] = t.amount
                            it[BankTransactionsExt.currencyCode] = t.currencyCode
                            it[BankTransactionsExt.description] = t.description
                            it[BankTransactionsExt.categoryHint] = t.categoryHint
                            it[BankTransactionsExt.madeOn] = t.madeOn
                            it[BankTransactionsExt.merchantName] = t.merchantName
                            it[BankTransactionsExt.extra] = t.extra?.toString()
                            it[BankTransactionsExt.status] = t.status
                            it[BankTransactionsExt.raw] = t.raw.toString()
                            it[BankTransactionsExt.createdAt] = Instant.now()
                        }
                    }
                }
            }
        }
    }
}
