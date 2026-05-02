package cz.cointrack.sync

import cz.cointrack.db.*
import cz.cointrack.plugins.ApiException
import cz.cointrack.sharing.AccountShareService
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.*
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.*
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * Synchronizace mezi klienty a serverem.
 *
 * Klíčový design: klient pracuje výhradně se **sync_id** UUID, které se generují na klientovi
 * a zůstávají stabilní napříč zařízeními. Server ukládá sync_id + generuje vlastní db_id
 * (primární klíč). Při cross-entity reference (např. account.profileId) klient posílá sync_id
 * cílové entity, server ho překládá na db_id při zápisu a zpět při čtení.
 */
class SyncService {

    // ═══════════════════════════════════════════════════════════════════
    // Access control helpers (Sprint 5e.4)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Vrátí orgId kde user má roli owner nebo admin (plný přístup ke všem profilům v orgu).
     */
    private fun Transaction.orgsWhereAdmin(userId: UUID): List<UUID> =
        OrganizationMembers.selectAll()
            .where {
                (OrganizationMembers.userId eq userId) and
                    (OrganizationMembers.role inList listOf("owner", "admin"))
            }
            .map { it[OrganizationMembers.organizationId].value }

    /**
     * GROUP orgy kde je user ANY member (owner/admin/member) — ve skupinách všichni
     * členové mají plny přístup (jinak by běžný member neviděl výdaje).
     */
    private fun Transaction.groupOrgsWhereMember(userId: UUID): List<UUID> {
        val memberships = OrganizationMembers.selectAll()
            .where { OrganizationMembers.userId eq userId }
            .map { it[OrganizationMembers.organizationId].value }
        if (memberships.isEmpty()) return emptyList()
        return Organizations.selectAll()
            .where {
                (Organizations.id inList memberships) and
                    (Organizations.type eq "GROUP") and
                    Organizations.deletedAt.isNull()
            }
            .map { it[Organizations.id].value }
    }

    /**
     * IDs profilů, kde má user per-profile permission (view nebo edit).
     * Sprint 5f.
     */
    private fun Transaction.profilesWithPermission(userId: UUID, minLevel: String = "view"): List<UUID> {
        val allowed = if (minLevel == "edit") listOf("edit") else listOf("view", "edit")
        return ProfilePermissions.selectAll()
            .where {
                (ProfilePermissions.userId eq userId) and
                    (ProfilePermissions.permission inList allowed)
            }
            .map { it[ProfilePermissions.profileId].value }
    }

    /**
     * Profily které vidí user U:
     *   - vlastní (ownerUserId == U) — personal i org
     *   - všechny v B2B orgech, kde U je owner/admin
     *   - všechny v GROUP orgech, kde U je ANY member (i jen role=member)
     *   - profily s per-profile permissions (view nebo edit) — Sprint 5f
     */
    private fun Transaction.accessibleProfileIds(userId: UUID): List<UUID> {
        val adminOrgs = orgsWhereAdmin(userId)
        val groupOrgs = groupOrgsWhereMember(userId)
        val allAccessibleOrgs = (adminOrgs + groupOrgs).distinct()
        val permissionProfiles = profilesWithPermission(userId, "view")
        return Profiles.selectAll()
            .where {
                (Profiles.ownerUserId eq userId) or
                    (if (allAccessibleOrgs.isNotEmpty()) Profiles.organizationId inList allAccessibleOrgs else Op.FALSE) or
                    (if (permissionProfiles.isNotEmpty()) Profiles.id inList permissionProfiles else Op.FALSE)
            }
            .map { it[Profiles.id].value }
    }

    /**
     * V21/V23 — per-account sharing. Vrátí seznam sdílených účtů s visibility filtry.
     * Jen pro role VIEWER/EDITOR. ACCOUNTANT je v [accountantSharedProfileIds].
     */
    data class SharedAccountSpec(
        val accountId: UUID,
        val profileId: UUID,
        val visibilityIncome: Boolean,
        val visibilityExpenses: Boolean,
        /** null = bez filtru, jinak whitelist syncId kategorií. Empty list = nic. */
        val visibilityCategories: Set<String>?,
    )

    private fun Transaction.sharedAccountInfoForUser(userId: UUID): List<SharedAccountSpec> {
        return AccountShares.selectAll()
            .where {
                (AccountShares.userId eq userId) and
                    AccountShares.acceptedAt.isNotNull() and
                    AccountShares.revokedAt.isNull() and
                    (AccountShares.role neq "ACCOUNTANT")
            }
            .mapNotNull { share ->
                val accountId = share[AccountShares.accountId].value
                val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                    ?: return@mapNotNull null
                if (acc[Accounts.deletedAt] != null) return@mapNotNull null
                val profileId = acc[Accounts.profileId].value
                SharedAccountSpec(
                    accountId = accountId,
                    profileId = profileId,
                    visibilityIncome = share[AccountShares.visibilityIncome],
                    visibilityExpenses = share[AccountShares.visibilityExpenses],
                    visibilityCategories = AccountShareService
                        .parseCategoryFilter(share[AccountShares.visibilityCategories])
                        ?.toSet(),
                )
            }
    }

    /**
     * V23 — vrací zda tx splňuje visibility filter sdíleného účtu (VIEWER/EDITOR).
     * Pro ACCOUNTANT a vlastníka se nevolá — ti vidí vše.
     */
    private fun passesShareVisibility(
        row: ResultRow,
        specByAccount: Map<UUID, SharedAccountSpec>,
        categoryIdToSync: Map<UUID, UUID>,
    ): Boolean {
        val accId = row[Transactions.accountId]?.value ?: return true
        val spec = specByAccount[accId] ?: return true  // ne-sdílený = bez filteru

        val amount = row[Transactions.amount]
        val isTransfer = row[Transactions.isTransfer]
        val isIncome = amount.signum() > 0
        val passesType = when {
            isTransfer -> spec.visibilityIncome || spec.visibilityExpenses
            isIncome -> spec.visibilityIncome
            else -> spec.visibilityExpenses
        }
        if (!passesType) return false

        val catFilter = spec.visibilityCategories ?: return true
        if (catFilter.isEmpty()) return false  // explicit "nic"
        val catId = row[Transactions.categoryId]?.value
            ?: return true  // tx bez kategorie — tolerantně pouštíme
        val catSyncId = categoryIdToSync[catId]?.toString() ?: return false
        return catFilter.contains(catSyncId)
    }

    /**
     * V22 — ACCOUNTANT share. Vrátí seznam profile IDs, ke kterým má user roli ACCOUNTANT.
     * Účetní vidí celý profil (všechny účty, kategorie, transakce, doklady) — read-only
     * pro vše kromě dokladů, které může editovat (kontrola se děje v upsert vrstvě).
     */
    private fun Transaction.accountantSharedProfileIds(userId: UUID): List<UUID> {
        return AccountShares.selectAll()
            .where {
                (AccountShares.userId eq userId) and
                    AccountShares.acceptedAt.isNotNull() and
                    AccountShares.revokedAt.isNull() and
                    (AccountShares.role eq "ACCOUNTANT")
            }
            .mapNotNull { share ->
                val accountId = share[AccountShares.accountId].value
                val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                    ?: return@mapNotNull null
                if (acc[Accounts.deletedAt] != null) return@mapNotNull null
                acc[Accounts.profileId].value
            }
            .distinct()
    }

    /**
     * Může user zapisovat do profilu?
     * Podmínky:
     *   - vlastní profil, nebo
     *   - admin/owner B2B orgu kam profil patří, nebo
     *   - ANY member GROUP orgu kam profil patří (ve skupinách všichni píšou), nebo
     *   - per-profile permission 'edit' (Sprint 5f)
     */
    private fun Transaction.canWriteProfile(userId: UUID, profileRow: ResultRow): Boolean {
        if (profileRow[Profiles.ownerUserId].value == userId) return true
        val orgId = profileRow[Profiles.organizationId]?.value
        if (orgId != null) {
            if (orgId in orgsWhereAdmin(userId)) return true
            if (orgId in groupOrgsWhereMember(userId)) return true
        }
        val profileId = profileRow[Profiles.id].value
        return ProfilePermissions.selectAll()
            .where {
                (ProfilePermissions.profileId eq profileId) and
                    (ProfilePermissions.userId eq userId) and
                    (ProfilePermissions.permission eq "edit")
            }.any()
    }

    // ═══════════════════════════════════════════════════════════════════
    // PULL: GET /sync?since=ISO
    // ═══════════════════════════════════════════════════════════════════

    suspend fun pull(userId: UUID, since: Instant?): SyncPullResponse {
        val serverTime = Instant.now()
        val effectiveSince = since ?: Instant.EPOCH

        return db {
            // Truly owned (write access): vlastní + B2B orgs (admin/owner) + GROUP orgs + permissions
            val ownedProfileIds = accessibleProfileIds(userId)

            // V22 — ACCOUNTANT shares: full profile access (all accounts/transactions/etc)
            val accountantProfileIds = accountantSharedProfileIds(userId)
                .filter { it !in ownedProfileIds }  // pokud někdo má vlastní + accountant, prefer owned
            // Combined: účetní vidí profil "jako vlastní" co se týče čtení (užívá se pro queries
            // entit které accountant musí vidět: budgets, debts, kategorie, …).
            val userProfileIds = (ownedProfileIds + accountantProfileIds).distinct()

            // V21 — per-account sharing: účty které mám přijaté jako VIEWER/EDITOR share
            val sharedAccountSpecs = sharedAccountInfoForUser(userId)
            val sharedAccountIds = sharedAccountSpecs.map { it.accountId }
            val specByAccount: Map<UUID, SharedAccountSpec> =
                sharedAccountSpecs.associateBy { it.accountId }
            // Parent profily sdílených účtů — frontend je zobrazí jako "shared" read-only
            val sharedProfileIds = sharedAccountSpecs.map { it.profileId }
                .filter { it !in userProfileIds }
                .distinct()

            // Union pro entity, které musí vidět celý profile (profile metadata, kategorie)
            val visibleProfileIds = (userProfileIds + sharedProfileIds).distinct()

            // V29 fix: po acceptu share má recipient.lastSync z doby PŘED přijetím share. Server-side
            // filter `updatedAt > effectiveSince` by vyloučil staré entity sdílených účtů (vlastník je
            // vytvořil dávno = updatedAt < lastSync). Detect: nejnovější acceptedAt > effectiveSince
            // = "po posledním sync přibyl nový/aktivovaný share" = pro shared data udělej full pull.
            // Po prvním sync po acceptu se lastSync posune za acceptedAt → další syncy budou inkrementální.
            val latestSharedAcceptedAt: Instant = AccountShares.selectAll()
                .where {
                    (AccountShares.userId eq userId) and
                        AccountShares.acceptedAt.isNotNull() and
                        AccountShares.revokedAt.isNull()
                }
                .mapNotNull { it[AccountShares.acceptedAt] }
                .maxOrNull() ?: Instant.EPOCH
            val effectiveSinceForShared: Instant =
                if (effectiveSince.isBefore(latestSharedAcceptedAt)) Instant.EPOCH else effectiveSince

            // Mapování db_id → sync_id pro každou referenční tabulku
            val profileIdToSync = if (visibleProfileIds.isEmpty()) emptyMap() else
                Profiles.selectAll()
                    .where { Profiles.id inList visibleProfileIds }
                    .associate { it[Profiles.id].value to it[Profiles.syncId] }

            // Účty: vlastní + sdílené
            val accountIdToSync = run {
                val ownedQuery = if (userProfileIds.isEmpty()) emptyMap() else
                    Accounts.selectAll()
                        .where { Accounts.profileId inList userProfileIds }
                        .associate { it[Accounts.id].value to it[Accounts.syncId] }
                val sharedQuery = if (sharedAccountIds.isEmpty()) emptyMap() else
                    Accounts.selectAll()
                        .where { Accounts.id inList sharedAccountIds }
                        .associate { it[Accounts.id].value to it[Accounts.syncId] }
                ownedQuery + sharedQuery
            }

            val categoryIdToSync = if (visibleProfileIds.isEmpty()) emptyMap() else
                Categories.selectAll()
                    .where { Categories.profileId inList visibleProfileIds }
                    .associate { it[Categories.id].value to it[Categories.syncId] }

            // Transactions/Receipts/Invoices: owned profiles + napojené na sdílené účty.
            // V23: shared tx procházejí visibility filtrem (per share role/income/expenses/categories).
            val sharedTxRowsAllVisible: List<ResultRow> = if (sharedAccountIds.isEmpty()) emptyList() else
                Transactions.selectAll()
                    .where { Transactions.accountId inList sharedAccountIds }
                    .filter { passesShareVisibility(it, specByAccount, categoryIdToSync) }
            val transactionIdToSync = run {
                val owned = if (userProfileIds.isEmpty()) emptyMap() else
                    Transactions.selectAll()
                        .where { Transactions.profileId inList userProfileIds }
                        .associate { it[Transactions.id].value to it[Transactions.syncId] }
                val shared = sharedTxRowsAllVisible
                    .associate { it[Transactions.id].value to it[Transactions.syncId] }
                owned + shared
            }

            val receiptIdToSync = run {
                val owned = if (userProfileIds.isEmpty()) emptyMap() else
                    Receipts.selectAll()
                        .where { Receipts.profileId inList userProfileIds }
                        .associate { it[Receipts.id].value to it[Receipts.syncId] }
                // Receipts napojené na sdílené účty přes transactionId.accountId
                val sharedTransactionIds = transactionIdToSync.keys.toList() // už zahrnuje sdílené
                val shared = if (sharedTransactionIds.isEmpty()) emptyMap() else
                    Receipts.selectAll()
                        .where { Receipts.transactionId inList sharedTransactionIds }
                        .associate { it[Receipts.id].value to it[Receipts.syncId] }
                owned + shared
            }

            val invoiceIdToSync = run {
                val owned = if (userProfileIds.isEmpty()) emptyMap() else
                    Invoices.selectAll()
                        .where { Invoices.profileId inList userProfileIds }
                        .associate { it[Invoices.id].value to it[Invoices.syncId] }
                val shared = if (sharedAccountIds.isEmpty()) emptyMap() else
                    Invoices.selectAll()
                        .where { Invoices.linkedAccountId inList sharedAccountIds }
                        .associate { it[Invoices.id].value to it[Invoices.syncId] }
                owned + shared
            }

            val result = mutableMapOf<String, List<SyncEntity>>()

            // V29: shared (accountant + sharedProfile) profily se filtrují přes effectiveSinceForShared,
            // owned přes effectiveSince — incremental pro vlastníka, full-pull pro recipient po acceptu.
            // V30: distinctBy syncId — defense-in-depth proti duplicitám i v rámci jedné odpovědi
            // (kdyby se profil objevil v owned i shared logice díky race condition v member shipu).
            result["profiles"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Profiles.selectAll()
                        .where { (Profiles.id inList ownedProfileIds) and (Profiles.updatedAt greater effectiveSince) }
                        .map { profileToEntity(it) }
                val sharedPids = (accountantProfileIds + sharedProfileIds).distinct()
                val shared = if (sharedPids.isEmpty()) emptyList() else
                    Profiles.selectAll()
                        .where { (Profiles.id inList sharedPids) and (Profiles.updatedAt greater effectiveSinceForShared) }
                        .map { profileToEntity(it) }
                (owned + shared).distinctBy { it.syncId }
            }

            result["accounts"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Accounts.selectAll()
                        .where { (Accounts.profileId inList ownedProfileIds) and (Accounts.updatedAt greater effectiveSince) }
                        .map { accountToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Accounts.selectAll()
                        .where { (Accounts.profileId inList accountantProfileIds) and (Accounts.updatedAt greater effectiveSinceForShared) }
                        .map { accountToEntity(it, profileIdToSync) }
                val shared = if (sharedAccountIds.isEmpty()) emptyList() else
                    Accounts.selectAll()
                        .where { (Accounts.id inList sharedAccountIds) and (Accounts.updatedAt greater effectiveSinceForShared) }
                        .map { accountToEntity(it, profileIdToSync) }
                owned + accountant + shared
            }

            result["categories"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Categories.selectAll()
                        .where { (Categories.profileId inList ownedProfileIds) and (Categories.updatedAt greater effectiveSince) }
                        .map { categoryToEntity(it, profileIdToSync) }
                val sharedPids = (accountantProfileIds + sharedProfileIds).distinct()
                val shared = if (sharedPids.isEmpty()) emptyList() else
                    Categories.selectAll()
                        .where { (Categories.profileId inList sharedPids) and (Categories.updatedAt greater effectiveSinceForShared) }
                        .map { categoryToEntity(it, profileIdToSync) }
                owned + shared
            }

            result["transactions"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Transactions.selectAll()
                        .where { (Transactions.profileId inList ownedProfileIds) and (Transactions.updatedAt greater effectiveSince) }
                        .map { transactionToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Transactions.selectAll()
                        .where { (Transactions.profileId inList accountantProfileIds) and (Transactions.updatedAt greater effectiveSinceForShared) }
                        .map { transactionToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }
                val shared = sharedTxRowsAllVisible
                    .filter { row ->
                        row[Transactions.profileId].value !in userProfileIds &&
                            row[Transactions.updatedAt] > effectiveSinceForShared
                    }
                    .map { transactionToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }
                owned + accountant + shared
            }

            result["receipts"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Receipts.selectAll()
                        .where { (Receipts.profileId inList ownedProfileIds) and (Receipts.updatedAt greater effectiveSince) }
                        .map { receiptToEntity(it, profileIdToSync, categoryIdToSync, transactionIdToSync, accountIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Receipts.selectAll()
                        .where { (Receipts.profileId inList accountantProfileIds) and (Receipts.updatedAt greater effectiveSinceForShared) }
                        .map { receiptToEntity(it, profileIdToSync, categoryIdToSync, transactionIdToSync, accountIdToSync) }
                val sharedTxIds = transactionIdToSync.keys.toList()
                val shared = if (sharedTxIds.isEmpty()) emptyList() else
                    Receipts.selectAll()
                        .where {
                            (Receipts.transactionId inList sharedTxIds) and
                                (Receipts.profileId notInList userProfileIds) and
                                (Receipts.updatedAt greater effectiveSinceForShared)
                        }
                        .map { receiptToEntity(it, profileIdToSync, categoryIdToSync, transactionIdToSync, accountIdToSync) }
                owned + accountant + shared
            }

            result["invoices"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Invoices.selectAll()
                        .where { (Invoices.profileId inList ownedProfileIds) and (Invoices.updatedAt greater effectiveSince) }
                        .map { invoiceToEntity(it, profileIdToSync, categoryIdToSync, accountIdToSync, transactionIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Invoices.selectAll()
                        .where { (Invoices.profileId inList accountantProfileIds) and (Invoices.updatedAt greater effectiveSinceForShared) }
                        .map { invoiceToEntity(it, profileIdToSync, categoryIdToSync, accountIdToSync, transactionIdToSync) }
                val shared = if (sharedAccountIds.isEmpty()) emptyList() else
                    Invoices.selectAll()
                        .where {
                            (Invoices.linkedAccountId inList sharedAccountIds) and
                                (Invoices.profileId notInList userProfileIds) and
                                (Invoices.updatedAt greater effectiveSinceForShared)
                        }
                        .map { invoiceToEntity(it, profileIdToSync, categoryIdToSync, accountIdToSync, transactionIdToSync) }
                owned + accountant + shared
            }

            // receipt_items / invoice_items: parent v receiptIdToSync/invoiceIdToSync (= owned + shared).
            // Použijeme effectiveSinceForShared — zachytí staré items sdílených parents. Pro owners bez share
            // je effectiveSinceForShared == effectiveSince, takže žádný overhead.
            result["receipt_items"] = if (receiptIdToSync.isEmpty()) emptyList() else
                ReceiptItems.selectAll()
                    .where { (ReceiptItems.receiptId inList receiptIdToSync.keys.toList()) and (ReceiptItems.updatedAt greater effectiveSinceForShared) }
                    .map { receiptItemToEntity(it, receiptIdToSync) }

            result["invoice_items"] = if (invoiceIdToSync.isEmpty()) emptyList() else
                InvoiceItems.selectAll()
                    .where { (InvoiceItems.invoiceId inList invoiceIdToSync.keys.toList()) and (InvoiceItems.updatedAt greater effectiveSinceForShared) }
                    .map { invoiceItemToEntity(it, invoiceIdToSync) }

            // V29: pro všechny profile-scoped entity rozděl owned (effectiveSince) +
            // accountant (effectiveSinceForShared). Pro vlastníky bez share je obě totéž.
            result["loyalty_cards"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    LoyaltyCards.selectAll()
                        .where { (LoyaltyCards.profileId inList ownedProfileIds) and (LoyaltyCards.updatedAt greater effectiveSince) }
                        .map { loyaltyCardToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    LoyaltyCards.selectAll()
                        .where { (LoyaltyCards.profileId inList accountantProfileIds) and (LoyaltyCards.updatedAt greater effectiveSinceForShared) }
                        .map { loyaltyCardToEntity(it, profileIdToSync) }
                owned + accountant
            }

            // ── Sprint 5c.5 entities ───────────────────────────────────
            result["budgets"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Budgets.selectAll()
                        .where { (Budgets.profileId inList ownedProfileIds) and (Budgets.updatedAt greater effectiveSince) }
                        .map { budgetToEntity(it, profileIdToSync, categoryIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Budgets.selectAll()
                        .where { (Budgets.profileId inList accountantProfileIds) and (Budgets.updatedAt greater effectiveSinceForShared) }
                        .map { budgetToEntity(it, profileIdToSync, categoryIdToSync) }
                owned + accountant
            }

            result["planned_payments"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    PlannedPayments.selectAll()
                        .where { (PlannedPayments.profileId inList ownedProfileIds) and (PlannedPayments.updatedAt greater effectiveSince) }
                        .map { plannedPaymentToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    PlannedPayments.selectAll()
                        .where { (PlannedPayments.profileId inList accountantProfileIds) and (PlannedPayments.updatedAt greater effectiveSinceForShared) }
                        .map { plannedPaymentToEntity(it, profileIdToSync, accountIdToSync, categoryIdToSync) }
                owned + accountant
            }

            result["debts"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Debts.selectAll()
                        .where { (Debts.profileId inList ownedProfileIds) and (Debts.updatedAt greater effectiveSince) }
                        .map { debtToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Debts.selectAll()
                        .where { (Debts.profileId inList accountantProfileIds) and (Debts.updatedAt greater effectiveSinceForShared) }
                        .map { debtToEntity(it, profileIdToSync) }
                owned + accountant
            }

            result["goals"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Goals.selectAll()
                        .where { (Goals.profileId inList ownedProfileIds) and (Goals.updatedAt greater effectiveSince) }
                        .map { goalToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Goals.selectAll()
                        .where { (Goals.profileId inList accountantProfileIds) and (Goals.updatedAt greater effectiveSinceForShared) }
                        .map { goalToEntity(it, profileIdToSync) }
                owned + accountant
            }

            result["warranties"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    Warranties.selectAll()
                        .where { (Warranties.profileId inList ownedProfileIds) and (Warranties.updatedAt greater effectiveSince) }
                        .map { warrantyToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    Warranties.selectAll()
                        .where { (Warranties.profileId inList accountantProfileIds) and (Warranties.updatedAt greater effectiveSinceForShared) }
                        .map { warrantyToEntity(it, profileIdToSync) }
                owned + accountant
            }

            val shoppingListIdToSync = if (userProfileIds.isEmpty()) emptyMap() else
                ShoppingLists.selectAll()
                    .where { ShoppingLists.profileId inList userProfileIds }
                    .associate { it[ShoppingLists.id].value to it[ShoppingLists.syncId] }

            result["shopping_lists"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    ShoppingLists.selectAll()
                        .where { (ShoppingLists.profileId inList ownedProfileIds) and (ShoppingLists.updatedAt greater effectiveSince) }
                        .map { shoppingListToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    ShoppingLists.selectAll()
                        .where { (ShoppingLists.profileId inList accountantProfileIds) and (ShoppingLists.updatedAt greater effectiveSinceForShared) }
                        .map { shoppingListToEntity(it, profileIdToSync) }
                owned + accountant
            }

            result["shopping_items"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    (ShoppingItems innerJoin ShoppingLists).selectAll()
                        .where { (ShoppingLists.profileId inList ownedProfileIds) and (ShoppingItems.updatedAt greater effectiveSince) }
                        .map { shoppingItemToEntity(it, shoppingListIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    (ShoppingItems innerJoin ShoppingLists).selectAll()
                        .where { (ShoppingLists.profileId inList accountantProfileIds) and (ShoppingItems.updatedAt greater effectiveSinceForShared) }
                        .map { shoppingItemToEntity(it, shoppingListIdToSync) }
                owned + accountant
            }

            result["merchant_rules"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    MerchantRules.selectAll()
                        .where { (MerchantRules.profileId inList ownedProfileIds) and (MerchantRules.updatedAt greater effectiveSince) }
                        .map { merchantRuleToEntity(it, profileIdToSync, categoryIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    MerchantRules.selectAll()
                        .where { (MerchantRules.profileId inList accountantProfileIds) and (MerchantRules.updatedAt greater effectiveSinceForShared) }
                        .map { merchantRuleToEntity(it, profileIdToSync, categoryIdToSync) }
                owned + accountant
            }

            result["investment_positions"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    InvestmentPositions.selectAll()
                        .where { (InvestmentPositions.profileId inList ownedProfileIds) and (InvestmentPositions.updatedAt greater effectiveSince) }
                        .map { investmentPositionToEntity(it, profileIdToSync, accountIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    InvestmentPositions.selectAll()
                        .where { (InvestmentPositions.profileId inList accountantProfileIds) and (InvestmentPositions.updatedAt greater effectiveSinceForShared) }
                        .map { investmentPositionToEntity(it, profileIdToSync, accountIdToSync) }
                owned + accountant
            }

            result["fio_accounts"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    FioAccounts.selectAll()
                        .where { (FioAccounts.profileId inList ownedProfileIds) and (FioAccounts.updatedAt greater effectiveSince) }
                        .map { fioAccountToEntity(it, profileIdToSync, accountIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    FioAccounts.selectAll()
                        .where { (FioAccounts.profileId inList accountantProfileIds) and (FioAccounts.updatedAt greater effectiveSinceForShared) }
                        .map { fioAccountToEntity(it, profileIdToSync, accountIdToSync) }
                owned + accountant
            }

            // ── Sprint 5g.2.d: skupinové entity ─────────────────────────
            result["group_members"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    GroupMembers.selectAll()
                        .where { (GroupMembers.profileId inList ownedProfileIds) and (GroupMembers.updatedAt greater effectiveSince) }
                        .map { groupMemberToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    GroupMembers.selectAll()
                        .where { (GroupMembers.profileId inList accountantProfileIds) and (GroupMembers.updatedAt greater effectiveSinceForShared) }
                        .map { groupMemberToEntity(it, profileIdToSync) }
                owned + accountant
            }

            result["group_expenses"] = run {
                val owned = if (ownedProfileIds.isEmpty()) emptyList() else
                    GroupExpenses.selectAll()
                        .where { (GroupExpenses.profileId inList ownedProfileIds) and (GroupExpenses.updatedAt greater effectiveSince) }
                        .map { groupExpenseToEntity(it, profileIdToSync) }
                val accountant = if (accountantProfileIds.isEmpty()) emptyList() else
                    GroupExpenses.selectAll()
                        .where { (GroupExpenses.profileId inList accountantProfileIds) and (GroupExpenses.updatedAt greater effectiveSinceForShared) }
                        .map { groupExpenseToEntity(it, profileIdToSync) }
                owned + accountant
            }

            val groupExpenseIdsForItems = GroupExpenses.selectAll()
                .where { GroupExpenses.profileId inList userProfileIds }
                .associate { it[GroupExpenses.id].value to it[GroupExpenses.syncId] }

            result["group_expense_items"] = if (userProfileIds.isEmpty() || groupExpenseIdsForItems.isEmpty()) emptyList() else
                GroupExpenseItems.selectAll()
                    .where {
                        (GroupExpenseItems.expenseId inList groupExpenseIdsForItems.keys) and
                            (GroupExpenseItems.updatedAt greater effectiveSinceForShared)
                    }
                    .map { groupExpenseItemToEntity(it, groupExpenseIdsForItems) }

            SyncPullResponse(serverTime.toString(), result)
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PUSH: POST /sync
    // ═══════════════════════════════════════════════════════════════════

    suspend fun push(userId: UUID, req: SyncPushRequest): SyncPushResponse = db {
        val accepted = mutableMapOf<String, MutableList<String>>()
        val conflicts = mutableMapOf<String, MutableList<SyncEntity>>()

        // Zpracuj entity v pořadí, v jakém se vyskytují v requestu
        // (očekáváme profiles → accounts/categories → transactions → receipts/invoices → items)
        for ((typeKey, entities) in req.entities) {
            val type = SyncEntityType.fromKey(typeKey) ?: continue
            for (entity in entities) {
                val result = upsertEntity(userId, type, entity)
                when (result) {
                    UpsertResult.Accepted -> accepted.getOrPut(typeKey) { mutableListOf() }.add(entity.syncId)
                    UpsertResult.Forbidden -> { /* ignoruj */ }
                    is UpsertResult.Conflict -> conflicts.getOrPut(typeKey) { mutableListOf() }.add(result.serverEntity)
                }
            }
        }

        SyncPushResponse(accepted, conflicts)
    }


    private fun Transaction.upsertEntity(userId: UUID, type: SyncEntityType, e: SyncEntity): UpsertResult {
        val syncId = UUID.fromString(e.syncId)
        val updatedAt = Instant.parse(e.updatedAt)
        val deletedAt = e.deletedAt?.let { Instant.parse(it) }

        return when (type) {
            SyncEntityType.PROFILES      -> upsertProfile(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.ACCOUNTS      -> upsertAccount(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.CATEGORIES    -> upsertCategory(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.TRANSACTIONS  -> upsertTransaction(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.RECEIPTS      -> upsertReceipt(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.INVOICES      -> upsertInvoice(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.RECEIPT_ITEMS -> upsertReceiptItem(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.INVOICE_ITEMS -> upsertInvoiceItem(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.LOYALTY_CARDS -> upsertLoyaltyCard(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.BUDGETS              -> upsertBudget(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.PLANNED_PAYMENTS     -> upsertPlannedPayment(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.DEBTS                -> upsertDebt(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.GOALS                -> upsertGoal(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.WARRANTIES           -> upsertWarranty(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.SHOPPING_LISTS       -> upsertShoppingList(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.SHOPPING_ITEMS       -> upsertShoppingItem(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.MERCHANT_RULES       -> upsertMerchantRule(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.INVESTMENT_POSITIONS -> upsertInvestmentPosition(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.FIO_ACCOUNTS         -> upsertFioAccount(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.GROUP_MEMBERS        -> upsertGroupMember(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.GROUP_EXPENSES       -> upsertGroupExpense(userId, syncId, e, updatedAt, deletedAt)
            SyncEntityType.GROUP_EXPENSE_ITEMS  -> upsertGroupExpenseItem(userId, syncId, e, updatedAt, deletedAt)
        }
    }

    // ─── Helpers pro lookup / ownership check ──────────────────────────

    private fun Transaction.resolveProfileDbId(syncIdStr: String, userId: UUID): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        val row = Profiles.selectAll().where { Profiles.syncId eq syncId }.singleOrNull() ?: return null
        return if (canWriteProfile(userId, row)) row[Profiles.id].value else null
    }

    private fun Transaction.resolveAccountDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Accounts.selectAll().where { Accounts.syncId eq syncId }.singleOrNull()?.get(Accounts.id)?.value
    }

    private fun Transaction.resolveCategoryDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Categories.selectAll().where { Categories.syncId eq syncId }.singleOrNull()?.get(Categories.id)?.value
    }

    private fun Transaction.resolveTransactionDbId(syncIdStr: String?): UUID? {
        if (syncIdStr == null) return null
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Transactions.selectAll().where { Transactions.syncId eq syncId }.singleOrNull()?.get(Transactions.id)?.value
    }

    private fun Transaction.resolveReceiptDbId(syncIdStr: String): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Receipts.selectAll().where { Receipts.syncId eq syncId }.singleOrNull()?.get(Receipts.id)?.value
    }

    private fun Transaction.resolveInvoiceDbId(syncIdStr: String): UUID? {
        val syncId = runCatching { UUID.fromString(syncIdStr) }.getOrNull() ?: return null
        return Invoices.selectAll().where { Invoices.syncId eq syncId }.singleOrNull()?.get(Invoices.id)?.value
    }

    // ─── Profile upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertProfile(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val existing = Profiles.selectAll().where { Profiles.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (!canWriteProfile(userId, existing)) return UpsertResult.Forbidden
            if (existing[Profiles.updatedAt] >= updatedAt) return UpsertResult.Conflict(profileToEntity(existing))
            // Při změně typu — pokud existing.type je "PERSONAL" a user mění na BUSINESS/GROUP,
            // ověř tier (jinak by FREE user mohl obejít guard přes update existing PERSONAL profilu).
            val newType = e.data.strOrNull("type")?.uppercase()
            if (newType != null && newType != existing[Profiles.type].uppercase() &&
                !canCreateProfileType(userId, newType)) {
                return UpsertResult.Forbidden
            }
            Profiles.update({ Profiles.syncId eq syncId }) {
                applyProfileFields(it, e.data, e.clientVersion, updatedAt, deletedAt, userId)
            }
        } else {
            // Při vytváření nového profilu — tier guard:
            //   FREE / PERSONAL tier  → smí jen PERSONAL profil
            //   BUSINESS tier         → PERSONAL + BUSINESS
            //   BUSINESS_PRO          → PERSONAL + BUSINESS + GROUP + ORGANIZATION
            // Bez tohoto recipient FREE účtu mohl při onboardingu omylem vytvořit
            // BUSINESS / GROUP profily a zaplnit svůj account list.
            val newType = e.data.strOrNull("type")?.uppercase() ?: "PERSONAL"
            if (!canCreateProfileType(userId, newType)) {
                return UpsertResult.Forbidden
            }
            // Pokud e.data obsahuje organizationId, ověř že user je člen toho orgu.
            val orgId = resolveProfileOrganization(e.data, userId)
            Profiles.insert {
                it[Profiles.syncId] = syncId
                it[Profiles.ownerUserId] = userId
                it[Profiles.organizationId] = orgId
                it[Profiles.createdAt] = updatedAt
                applyProfileFields(it, e.data, e.clientVersion, updatedAt, deletedAt, userId)
            }
        }
        return UpsertResult.Accepted
    }

    /**
     * Tier-based gate: může user na svém tieru vytvořit profil daného typu?
     * - PERSONAL profil: vždy povolený (každý tier)
     * - BUSINESS profil: vyžaduje BUSINESS+ (BUSINESS, BUSINESS_PRO, ORGANIZATION)
     * - GROUP / ORGANIZATION profil: vyžaduje BUSINESS_PRO (sdílené týmové prostředí)
     */
    private fun Transaction.canCreateProfileType(userId: UUID, type: String): Boolean {
        val typeUpper = type.uppercase()
        if (typeUpper == "PERSONAL") return true
        val tier = Users.selectAll().where { Users.id eq userId }
            .singleOrNull()?.get(Users.tier)?.uppercase() ?: "FREE"
        return when (typeUpper) {
            "BUSINESS" -> tier in setOf("BUSINESS", "BUSINESS_PRO", "ORGANIZATION")
            "GROUP", "ORGANIZATION" -> tier in setOf("BUSINESS_PRO", "ORGANIZATION")
            else -> false  // unknown type = deny
        }
    }

    /**
     * Přečte organizationId z příchozího profilu a ověří členství. NULL pokud není
     * v datech nebo user není členem toho orgu.
     */
    private fun Transaction.resolveProfileOrganization(d: JsonObject, userId: UUID): EntityID<UUID>? {
        val orgIdStr = d.strOrNull("organizationId") ?: return null
        val orgId = runCatching { UUID.fromString(orgIdStr) }.getOrNull() ?: return null
        val isMember = OrganizationMembers.selectAll()
            .where {
                (OrganizationMembers.organizationId eq orgId) and
                    (OrganizationMembers.userId eq userId)
            }.any()
        if (!isMember) return null
        return EntityID(orgId, Organizations)
    }

    /**
     * @param userIdForOrgCheck UUID volajícího pro validaci organizationId (členství v orgu).
     *                          Null při jednoduchém update bez změny orgu (zachová současnou hodnotu).
     */
    private fun Transaction.applyProfileFields(
        s: UpdateBuilder<*>, d: JsonObject, clientVersion: Long, updatedAt: Instant, deletedAt: Instant?,
        userIdForOrgCheck: UUID? = null,
    ) {
        s[Profiles.name] = d.str("name")
        s[Profiles.type] = d.str("type")
        s[Profiles.color] = d.intOrNull("color")
        s[Profiles.businessFocus] = d.strOrNull("businessFocus")
        s[Profiles.ico] = d.strOrNull("ico")
        s[Profiles.dic] = d.strOrNull("dic")
        s[Profiles.companyName] = d.strOrNull("companyName")
        s[Profiles.street] = d.strOrNull("street")
        s[Profiles.zip] = d.strOrNull("zip")
        s[Profiles.city] = d.strOrNull("city")
        s[Profiles.phone] = d.strOrNull("phone")
        s[Profiles.email] = d.strOrNull("email")
        // Sprint 5e — přiřazení k orgu (NULL = osobní profil)
        if (userIdForOrgCheck != null && d.containsKey("organizationId")) {
            s[Profiles.organizationId] = resolveProfileOrganization(d, userIdForOrgCheck)
        }
        s[Profiles.clientVersion] = clientVersion
        s[Profiles.updatedAt] = updatedAt
        s[Profiles.deletedAt] = deletedAt
    }

    // ─── Account upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertAccount(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Accounts.selectAll().where { Accounts.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Accounts.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[Accounts.profileId].value }.singleOrNull()?.get(Profiles.syncId)
                return UpsertResult.Conflict(accountToEntity(existing, mapOf(existing[Accounts.profileId].value to (profileSync ?: UUID.randomUUID()))))
            }
            Accounts.update({ Accounts.syncId eq syncId }) {
                applyAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            Accounts.insert {
                it[Accounts.syncId] = syncId
                it[Accounts.createdAt] = updatedAt
                applyAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyAccountFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[Accounts.profileId] = EntityID(profileDbId, Profiles)
        s[Accounts.name] = d.str("name")
        s[Accounts.type] = d.str("type")
        s[Accounts.currency] = d.strOr("currency", "CZK")
        s[Accounts.initialBalance] = d.decimalOr("initialBalance", BigDecimal.ZERO)
        s[Accounts.color] = d.intOrNull("color")
        s[Accounts.icon] = d.strOrNull("icon")
        s[Accounts.excludedFromTotal] = d.boolOr("excludedFromTotal", false)
        s[Accounts.bankProvider] = d.strOrNull("bankProvider")
        s[Accounts.bankIban] = d.strOrNull("bankIban")
        s[Accounts.bankAccountNumber] = d.strOrNull("bankAccountNumber")
        s[Accounts.bankCode] = d.strOrNull("bankCode")
        s[Accounts.pohodaShortcut] = d.strOrNull("pohodaShortcut")
        s[Accounts.clientVersion] = cv
        s[Accounts.updatedAt] = updatedAt
        s[Accounts.deletedAt] = deletedAt
    }

    // ─── Category upsert ────────────────────────────────────────────────

    private fun Transaction.upsertCategory(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Categories.selectAll().where { Categories.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Categories.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[Categories.profileId].value }.singleOrNull()?.get(Profiles.syncId)
                return UpsertResult.Conflict(categoryToEntity(existing, mapOf(existing[Categories.profileId].value to (profileSync ?: UUID.randomUUID()))))
            }
            Categories.update({ Categories.syncId eq syncId }) {
                applyCategoryFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            Categories.insert {
                it[Categories.syncId] = syncId
                it[Categories.createdAt] = updatedAt
                applyCategoryFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyCategoryFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[Categories.profileId] = EntityID(profileDbId, Profiles)
        s[Categories.name] = d.str("name")
        s[Categories.nameEn] = d.strOrNull("nameEn")
        s[Categories.type] = d.str("type")
        s[Categories.color] = d.intOrNull("color")
        s[Categories.icon] = d.strOrNull("icon")
        s[Categories.position] = d.intOr("position", 0)
        s[Categories.clientVersion] = cv
        s[Categories.updatedAt] = updatedAt
        s[Categories.deletedAt] = deletedAt
    }

    // ─── Transaction upsert ─────────────────────────────────────────────

    private fun Transaction.upsertTransaction(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val accountDbId = resolveAccountDbId(e.data.strOrNull("accountId"))
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val existing = Transactions.selectAll().where { Transactions.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Transactions.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(transactionToEntity(existing, emptyMap(), emptyMap(), emptyMap()))
            }
            Transactions.update({ Transactions.syncId eq syncId }) {
                applyTransactionFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, accountDbId, categoryDbId, isInsert = false)
            }
        } else {
            Transactions.insert {
                it[Transactions.syncId] = syncId
                it[Transactions.createdAt] = updatedAt
                applyTransactionFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, accountDbId, categoryDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyTransactionFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, accountDbId: UUID?, categoryDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Transactions.profileId] = EntityID(profileDbId, Profiles)
        s[Transactions.accountId] = accountDbId?.let { EntityID(it, Accounts) }
        s[Transactions.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Transactions.amount] = d.decimal("amount")
        s[Transactions.currency] = d.strOr("currency", "CZK")
        s[Transactions.description] = d.strOrNull("description")
        s[Transactions.merchant] = d.strOrNull("merchant")
        s[Transactions.date] = LocalDate.parse(d.str("date"))
        s[Transactions.bankTxId] = d.strOrNull("bankTxId")
        s[Transactions.bankVs] = d.strOrNull("bankVs")
        s[Transactions.bankCounterparty] = d.strOrNull("bankCounterparty")
        s[Transactions.bankCounterpartyName] = d.strOrNull("bankCounterpartyName")
        s[Transactions.isTransfer] = d.boolOr("isTransfer", false)
        s[Transactions.transferPairId] = d.uuidOrNull("transferPairId")
        s[Transactions.clientVersion] = cv
        s[Transactions.updatedAt] = updatedAt
        s[Transactions.deletedAt] = deletedAt
    }

    // ─── Receipt upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertReceipt(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val transactionDbId = resolveTransactionDbId(e.data.strOrNull("transactionId"))
        // V29: linkedAccountId pro Pohoda export — ručně přiřazený účet (CARD platby).
        val linkedAccountDbId = resolveAccountDbId(e.data.strOrNull("linkedAccountId"))
        val existing = Receipts.selectAll().where { Receipts.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Receipts.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(receiptToEntity(existing, emptyMap(), emptyMap(), emptyMap(), emptyMap()))
            }
            Receipts.update({ Receipts.syncId eq syncId }) {
                applyReceiptFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, transactionDbId, linkedAccountDbId, isInsert = false)
            }
        } else {
            Receipts.insert {
                it[Receipts.syncId] = syncId
                it[Receipts.createdAt] = updatedAt
                applyReceiptFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, transactionDbId, linkedAccountDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyReceiptFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, categoryDbId: UUID?, transactionDbId: UUID?, linkedAccountDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Receipts.profileId] = EntityID(profileDbId, Profiles)
        s[Receipts.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Receipts.transactionId] = transactionDbId?.let { EntityID(it, Transactions) }
        s[Receipts.linkedAccountId] = linkedAccountDbId?.let { EntityID(it, Accounts) }
        s[Receipts.merchantName] = d.strOrNull("merchantName")
        s[Receipts.merchantIco] = d.strOrNull("merchantIco")
        s[Receipts.merchantDic] = d.strOrNull("merchantDic")
        s[Receipts.merchantStreet] = d.strOrNull("merchantStreet")
        s[Receipts.merchantCity] = d.strOrNull("merchantCity")
        s[Receipts.merchantZip] = d.strOrNull("merchantZip")
        s[Receipts.date] = LocalDate.parse(d.str("date"))
        s[Receipts.time] = d.strOrNull("time")
        s[Receipts.totalWithVat] = d.decimalOr("totalWithVat", BigDecimal.ZERO)
        s[Receipts.totalWithoutVat] = d.decimalOrNull("totalWithoutVat")
        s[Receipts.currency] = d.strOr("currency", "CZK")
        s[Receipts.paymentMethod] = d.strOrNull("paymentMethod")
        s[Receipts.note] = d.strOrNull("note")
        s[Receipts.photoKeys] = d["photoKeys"]?.toString() ?: "[]"
        s[Receipts.clientVersion] = cv
        s[Receipts.updatedAt] = updatedAt
        s[Receipts.deletedAt] = deletedAt
    }

    // ─── Invoice upsert ─────────────────────────────────────────────────

    private fun Transaction.upsertInvoice(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val accountDbId = resolveAccountDbId(e.data.strOrNull("linkedAccountId"))
        val transactionDbId = resolveTransactionDbId(e.data.strOrNull("linkedTransactionId"))
        val existing = Invoices.selectAll().where { Invoices.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[Invoices.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(invoiceToEntity(existing, emptyMap(), emptyMap(), emptyMap(), emptyMap()))
            }
            Invoices.update({ Invoices.syncId eq syncId }) {
                applyInvoiceFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, accountDbId, transactionDbId, isInsert = false)
            }
        } else {
            Invoices.insert {
                it[Invoices.syncId] = syncId
                it[Invoices.createdAt] = updatedAt
                applyInvoiceFields(it, e.data, e.clientVersion, updatedAt, deletedAt,
                    profileDbId, categoryDbId, accountDbId, transactionDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyInvoiceFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, categoryDbId: UUID?, accountDbId: UUID?, transactionDbId: UUID?, isInsert: Boolean
    ) {
        if (isInsert) s[Invoices.profileId] = EntityID(profileDbId, Profiles)
        s[Invoices.categoryId] = categoryDbId?.let { EntityID(it, Categories) }
        s[Invoices.linkedAccountId] = accountDbId?.let { EntityID(it, Accounts) }
        s[Invoices.linkedTransactionId] = transactionDbId?.let { EntityID(it, Transactions) }
        s[Invoices.invoiceNumber] = d.strOrNull("invoiceNumber")
        s[Invoices.isExpense] = d.bool("isExpense")
        s[Invoices.issueDate] = d.strOrNull("issueDate")?.let { LocalDate.parse(it) }
        s[Invoices.dueDate] = d.strOrNull("dueDate")?.let { LocalDate.parse(it) }
        s[Invoices.totalWithVat] = d.decimalOr("totalWithVat", BigDecimal.ZERO)
        s[Invoices.totalWithoutVat] = d.decimalOrNull("totalWithoutVat")
        s[Invoices.currency] = d.strOr("currency", "CZK")
        s[Invoices.paymentMethod] = d.strOrNull("paymentMethod")
        s[Invoices.variableSymbol] = d.strOrNull("variableSymbol")
        s[Invoices.bankAccount] = d.strOrNull("bankAccount")
        s[Invoices.paid] = d.boolOr("paid", false)
        s[Invoices.supplierName] = d.strOrNull("supplierName")
        s[Invoices.supplierIco] = d.strOrNull("supplierIco")
        s[Invoices.supplierDic] = d.strOrNull("supplierDic")
        s[Invoices.supplierStreet] = d.strOrNull("supplierStreet")
        s[Invoices.supplierCity] = d.strOrNull("supplierCity")
        s[Invoices.supplierZip] = d.strOrNull("supplierZip")
        s[Invoices.customerName] = d.strOrNull("customerName")
        s[Invoices.note] = d.strOrNull("note")
        s[Invoices.fileKeys] = d["fileKeys"]?.toString() ?: "[]"
        s[Invoices.idokladId] = d.strOrNull("idokladId")
        // V30 — origin tracking. Server-side přidělené (přes EmailInboxService),
        // klient přepisovat nemůže — zachováme staré hodnoty pokud je sync push neobsahuje.
        d.strOrNull("source")?.let { s[Invoices.originSource] = it }
        s[Invoices.clientVersion] = cv
        s[Invoices.updatedAt] = updatedAt
        s[Invoices.deletedAt] = deletedAt
    }

    // ─── Receipt item upsert ────────────────────────────────────────────

    private fun Transaction.upsertReceiptItem(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val receiptDbId = resolveReceiptDbId(e.data.str("receiptId")) ?: return UpsertResult.Forbidden
        // Ověř ownership přes receipt.profile
        val receipt = Receipts.selectAll().where { Receipts.id eq receiptDbId }.singleOrNull() ?: return UpsertResult.Forbidden
        val profile = Profiles.selectAll().where { Profiles.id eq receipt[Receipts.profileId].value }.singleOrNull() ?: return UpsertResult.Forbidden
        if (!canWriteProfile(userId, profile)) return UpsertResult.Forbidden

        val existing = ReceiptItems.selectAll().where { ReceiptItems.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[ReceiptItems.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(receiptItemToEntity(existing, mapOf(receiptDbId to receipt[Receipts.syncId])))
            }
            ReceiptItems.update({ ReceiptItems.syncId eq syncId }) {
                applyReceiptItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, receiptDbId, isInsert = false)
            }
        } else {
            ReceiptItems.insert {
                it[ReceiptItems.syncId] = syncId
                it[ReceiptItems.createdAt] = updatedAt
                applyReceiptItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, receiptDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyReceiptItemFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        receiptDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[ReceiptItems.receiptId] = EntityID(receiptDbId, Receipts)
        s[ReceiptItems.name] = d.str("name")
        s[ReceiptItems.quantity] = d.decimalOr("quantity", BigDecimal.ONE)
        s[ReceiptItems.unitPrice] = d.decimalOrNull("unitPrice")
        s[ReceiptItems.totalPrice] = d.decimal("totalPrice")
        s[ReceiptItems.vatRate] = d.decimalOrNull("vatRate")
        s[ReceiptItems.position] = d.intOr("position", 0)
        s[ReceiptItems.clientVersion] = cv
        s[ReceiptItems.updatedAt] = updatedAt
        s[ReceiptItems.deletedAt] = deletedAt
    }

    // ─── Invoice item upsert ────────────────────────────────────────────

    private fun Transaction.upsertInvoiceItem(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val invoiceDbId = resolveInvoiceDbId(e.data.str("invoiceId")) ?: return UpsertResult.Forbidden
        val invoice = Invoices.selectAll().where { Invoices.id eq invoiceDbId }.singleOrNull() ?: return UpsertResult.Forbidden
        val profile = Profiles.selectAll().where { Profiles.id eq invoice[Invoices.profileId].value }.singleOrNull() ?: return UpsertResult.Forbidden
        if (!canWriteProfile(userId, profile)) return UpsertResult.Forbidden

        val existing = InvoiceItems.selectAll().where { InvoiceItems.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[InvoiceItems.updatedAt] >= updatedAt) {
                return UpsertResult.Conflict(invoiceItemToEntity(existing, mapOf(invoiceDbId to invoice[Invoices.syncId])))
            }
            InvoiceItems.update({ InvoiceItems.syncId eq syncId }) {
                applyInvoiceItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, invoiceDbId, isInsert = false)
            }
        } else {
            InvoiceItems.insert {
                it[InvoiceItems.syncId] = syncId
                it[InvoiceItems.createdAt] = updatedAt
                applyInvoiceItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, invoiceDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyInvoiceItemFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        invoiceDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[InvoiceItems.invoiceId] = EntityID(invoiceDbId, Invoices)
        s[InvoiceItems.name] = d.str("name")
        s[InvoiceItems.quantity] = d.decimalOr("quantity", BigDecimal.ONE)
        s[InvoiceItems.unitPriceWithVat] = d.decimalOrNull("unitPriceWithVat")
        s[InvoiceItems.totalPriceWithVat] = d.decimal("totalPriceWithVat")
        s[InvoiceItems.vatRate] = d.decimalOrNull("vatRate")
        s[InvoiceItems.position] = d.intOr("position", 0)
        s[InvoiceItems.clientVersion] = cv
        s[InvoiceItems.updatedAt] = updatedAt
        s[InvoiceItems.deletedAt] = deletedAt
    }

    // ─── Loyalty card upsert ────────────────────────────────────────────

    private fun Transaction.upsertLoyaltyCard(
        userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
    ): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = LoyaltyCards.selectAll().where { LoyaltyCards.syncId eq syncId }.singleOrNull()

        if (existing != null) {
            if (existing[LoyaltyCards.updatedAt] >= updatedAt) {
                val profileSync = Profiles.selectAll().where { Profiles.id eq existing[LoyaltyCards.profileId].value }
                    .singleOrNull()?.get(Profiles.syncId) ?: UUID.randomUUID()
                return UpsertResult.Conflict(loyaltyCardToEntity(existing, mapOf(existing[LoyaltyCards.profileId].value to profileSync)))
            }
            LoyaltyCards.update({ LoyaltyCards.syncId eq syncId }) {
                applyLoyaltyCardFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false)
            }
        } else {
            LoyaltyCards.insert {
                it[LoyaltyCards.syncId] = syncId
                it[LoyaltyCards.createdAt] = updatedAt
                applyLoyaltyCardFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyLoyaltyCardFields(
        s: UpdateBuilder<*>, d: JsonObject, cv: Long, updatedAt: Instant, deletedAt: Instant?,
        profileDbId: UUID, isInsert: Boolean
    ) {
        if (isInsert) s[LoyaltyCards.profileId] = EntityID(profileDbId, Profiles)
        s[LoyaltyCards.storeName] = d.str("storeName")
        s[LoyaltyCards.cardNumber] = d.str("cardNumber")
        s[LoyaltyCards.barcodeFormat] = d.strOr("barcodeFormat", "CODE_128")
        s[LoyaltyCards.color] = d.intOrNull("color")
        s[LoyaltyCards.note] = d.strOr("note", "")
        s[LoyaltyCards.logoUrl] = d.strOrNull("logoUrl")
        s[LoyaltyCards.frontImageKey] = d.strOrNull("frontImageKey")
        s[LoyaltyCards.backImageKey] = d.strOrNull("backImageKey")
        s[LoyaltyCards.clientVersion] = cv
        s[LoyaltyCards.updatedAt] = updatedAt
        s[LoyaltyCards.deletedAt] = deletedAt
    }

    // ═══════════════════════════════════════════════════════════════════
    // Mappery: ResultRow -> SyncEntity (db_id → sync_id translation)
    // ═══════════════════════════════════════════════════════════════════

    private fun profileToEntity(r: ResultRow) = SyncEntity(
        syncId = r[Profiles.syncId].toString(),
        updatedAt = r[Profiles.updatedAt].toString(),
        deletedAt = r[Profiles.deletedAt]?.toString(),
        clientVersion = r[Profiles.clientVersion],
        data = buildJsonObject {
            put("name", r[Profiles.name])
            put("type", r[Profiles.type])
            r[Profiles.color]?.let { put("color", it) }
            r[Profiles.businessFocus]?.let { put("businessFocus", it) }
            r[Profiles.ico]?.let { put("ico", it) }
            r[Profiles.dic]?.let { put("dic", it) }
            r[Profiles.companyName]?.let { put("companyName", it) }
            r[Profiles.street]?.let { put("street", it) }
            r[Profiles.zip]?.let { put("zip", it) }
            r[Profiles.city]?.let { put("city", it) }
            r[Profiles.phone]?.let { put("phone", it) }
            r[Profiles.email]?.let { put("email", it) }
            r[Profiles.organizationId]?.value?.let { put("organizationId", it.toString()) }
            put("ownerUserId", r[Profiles.ownerUserId].value.toString())
        },
    )

    private fun accountToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Accounts.syncId].toString(),
        updatedAt = r[Accounts.updatedAt].toString(),
        deletedAt = r[Accounts.deletedAt]?.toString(),
        clientVersion = r[Accounts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Accounts.profileId].value] ?: r[Accounts.profileId].value).toString())
            put("name", r[Accounts.name])
            put("type", r[Accounts.type])
            put("currency", r[Accounts.currency])
            put("initialBalance", r[Accounts.initialBalance].toPlainString())
            r[Accounts.color]?.let { put("color", it) }
            r[Accounts.icon]?.let { put("icon", it) }
            put("excludedFromTotal", r[Accounts.excludedFromTotal])
            r[Accounts.bankProvider]?.let { put("bankProvider", it) }
            r[Accounts.bankIban]?.let { put("bankIban", it) }
            r[Accounts.bankAccountNumber]?.let { put("bankAccountNumber", it) }
            r[Accounts.bankCode]?.let { put("bankCode", it) }
            r[Accounts.pohodaShortcut]?.let { put("pohodaShortcut", it) }
        },
    )

    private fun categoryToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Categories.syncId].toString(),
        updatedAt = r[Categories.updatedAt].toString(),
        deletedAt = r[Categories.deletedAt]?.toString(),
        clientVersion = r[Categories.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Categories.profileId].value] ?: r[Categories.profileId].value).toString())
            put("name", r[Categories.name])
            r[Categories.nameEn]?.let { put("nameEn", it) }
            put("type", r[Categories.type])
            r[Categories.color]?.let { put("color", it) }
            r[Categories.icon]?.let { put("icon", it) }
            put("position", r[Categories.position])
        },
    )

    private fun transactionToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        accountIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Transactions.syncId].toString(),
        updatedAt = r[Transactions.updatedAt].toString(),
        deletedAt = r[Transactions.deletedAt]?.toString(),
        clientVersion = r[Transactions.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Transactions.profileId].value] ?: r[Transactions.profileId].value).toString())
            r[Transactions.accountId]?.let {
                put("accountId", (accountIdToSync[it.value] ?: it.value).toString())
            }
            r[Transactions.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            put("amount", r[Transactions.amount].toPlainString())
            put("currency", r[Transactions.currency])
            r[Transactions.description]?.let { put("description", it) }
            r[Transactions.merchant]?.let { put("merchant", it) }
            put("date", r[Transactions.date].toString())
            r[Transactions.bankTxId]?.let { put("bankTxId", it) }
            r[Transactions.bankVs]?.let { put("bankVs", it) }
            r[Transactions.bankCounterparty]?.let { put("bankCounterparty", it) }
            r[Transactions.bankCounterpartyName]?.let { put("bankCounterpartyName", it) }
            put("isTransfer", r[Transactions.isTransfer])
            r[Transactions.transferPairId]?.let { put("transferPairId", it.toString()) }
        },
    )

    private fun receiptToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
        transactionIdToSync: Map<UUID, UUID>,
        accountIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Receipts.syncId].toString(),
        updatedAt = r[Receipts.updatedAt].toString(),
        deletedAt = r[Receipts.deletedAt]?.toString(),
        clientVersion = r[Receipts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Receipts.profileId].value] ?: r[Receipts.profileId].value).toString())
            r[Receipts.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            r[Receipts.transactionId]?.let {
                put("transactionId", (transactionIdToSync[it.value] ?: it.value).toString())
            }
            r[Receipts.linkedAccountId]?.let {
                put("linkedAccountId", (accountIdToSync[it.value] ?: it.value).toString())
            }
            r[Receipts.merchantName]?.let { put("merchantName", it) }
            r[Receipts.merchantIco]?.let { put("merchantIco", it) }
            r[Receipts.merchantDic]?.let { put("merchantDic", it) }
            r[Receipts.merchantStreet]?.let { put("merchantStreet", it) }
            r[Receipts.merchantCity]?.let { put("merchantCity", it) }
            r[Receipts.merchantZip]?.let { put("merchantZip", it) }
            put("date", r[Receipts.date].toString())
            r[Receipts.time]?.let { put("time", it) }
            put("totalWithVat", r[Receipts.totalWithVat].toPlainString())
            r[Receipts.totalWithoutVat]?.let { put("totalWithoutVat", it.toPlainString()) }
            put("currency", r[Receipts.currency])
            r[Receipts.paymentMethod]?.let { put("paymentMethod", it) }
            r[Receipts.note]?.let { put("note", it) }
            put("photoKeys", Json.parseToJsonElement(r[Receipts.photoKeys]))
            r[Receipts.exportedAt]?.let { put("exportedAt", it.toString()) }
        },
    )

    private fun receiptItemToEntity(r: ResultRow, receiptIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[ReceiptItems.syncId].toString(),
        updatedAt = r[ReceiptItems.updatedAt].toString(),
        deletedAt = r[ReceiptItems.deletedAt]?.toString(),
        clientVersion = r[ReceiptItems.clientVersion],
        data = buildJsonObject {
            put("receiptId", (receiptIdToSync[r[ReceiptItems.receiptId].value] ?: r[ReceiptItems.receiptId].value).toString())
            put("name", r[ReceiptItems.name])
            put("quantity", r[ReceiptItems.quantity].toPlainString())
            r[ReceiptItems.unitPrice]?.let { put("unitPrice", it.toPlainString()) }
            put("totalPrice", r[ReceiptItems.totalPrice].toPlainString())
            r[ReceiptItems.vatRate]?.let { put("vatRate", it.toPlainString()) }
            put("position", r[ReceiptItems.position])
        },
    )

    private fun invoiceToEntity(
        r: ResultRow,
        profileIdToSync: Map<UUID, UUID>,
        categoryIdToSync: Map<UUID, UUID>,
        accountIdToSync: Map<UUID, UUID>,
        transactionIdToSync: Map<UUID, UUID>,
    ) = SyncEntity(
        syncId = r[Invoices.syncId].toString(),
        updatedAt = r[Invoices.updatedAt].toString(),
        deletedAt = r[Invoices.deletedAt]?.toString(),
        clientVersion = r[Invoices.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Invoices.profileId].value] ?: r[Invoices.profileId].value).toString())
            r[Invoices.categoryId]?.let {
                put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.linkedAccountId]?.let {
                put("linkedAccountId", (accountIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.linkedTransactionId]?.let {
                put("linkedTransactionId", (transactionIdToSync[it.value] ?: it.value).toString())
            }
            r[Invoices.invoiceNumber]?.let { put("invoiceNumber", it) }
            put("isExpense", r[Invoices.isExpense])
            r[Invoices.issueDate]?.let { put("issueDate", it.toString()) }
            r[Invoices.dueDate]?.let { put("dueDate", it.toString()) }
            put("totalWithVat", r[Invoices.totalWithVat].toPlainString())
            r[Invoices.totalWithoutVat]?.let { put("totalWithoutVat", it.toPlainString()) }
            put("currency", r[Invoices.currency])
            r[Invoices.paymentMethod]?.let { put("paymentMethod", it) }
            r[Invoices.variableSymbol]?.let { put("variableSymbol", it) }
            r[Invoices.bankAccount]?.let { put("bankAccount", it) }
            put("paid", r[Invoices.paid])
            r[Invoices.supplierName]?.let { put("supplierName", it) }
            r[Invoices.supplierIco]?.let { put("supplierIco", it) }
            r[Invoices.supplierDic]?.let { put("supplierDic", it) }
            r[Invoices.supplierStreet]?.let { put("supplierStreet", it) }
            r[Invoices.supplierCity]?.let { put("supplierCity", it) }
            r[Invoices.supplierZip]?.let { put("supplierZip", it) }
            r[Invoices.customerName]?.let { put("customerName", it) }
            r[Invoices.note]?.let { put("note", it) }
            put("fileKeys", Json.parseToJsonElement(r[Invoices.fileKeys]))
            r[Invoices.idokladId]?.let { put("idokladId", it) }
            r[Invoices.exportedAt]?.let { put("exportedAt", it.toString()) }
            // V30 — origin tracking
            r[Invoices.originSource]?.let { put("source", it) }
            r[Invoices.emailSubject]?.let { put("emailSubject", it) }
            r[Invoices.emailSender]?.let { put("emailSender", it) }
            r[Invoices.emailReceivedAt]?.let { put("emailReceivedAt", it.toString()) }
        },
    )

    private fun invoiceItemToEntity(r: ResultRow, invoiceIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[InvoiceItems.syncId].toString(),
        updatedAt = r[InvoiceItems.updatedAt].toString(),
        deletedAt = r[InvoiceItems.deletedAt]?.toString(),
        clientVersion = r[InvoiceItems.clientVersion],
        data = buildJsonObject {
            put("invoiceId", (invoiceIdToSync[r[InvoiceItems.invoiceId].value] ?: r[InvoiceItems.invoiceId].value).toString())
            put("name", r[InvoiceItems.name])
            put("quantity", r[InvoiceItems.quantity].toPlainString())
            r[InvoiceItems.unitPriceWithVat]?.let { put("unitPriceWithVat", it.toPlainString()) }
            put("totalPriceWithVat", r[InvoiceItems.totalPriceWithVat].toPlainString())
            r[InvoiceItems.vatRate]?.let { put("vatRate", it.toPlainString()) }
            put("position", r[InvoiceItems.position])
        },
    )

    private fun loyaltyCardToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[LoyaltyCards.syncId].toString(),
        updatedAt = r[LoyaltyCards.updatedAt].toString(),
        deletedAt = r[LoyaltyCards.deletedAt]?.toString(),
        clientVersion = r[LoyaltyCards.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[LoyaltyCards.profileId].value] ?: r[LoyaltyCards.profileId].value).toString())
            put("storeName", r[LoyaltyCards.storeName])
            put("cardNumber", r[LoyaltyCards.cardNumber])
            put("barcodeFormat", r[LoyaltyCards.barcodeFormat])
            r[LoyaltyCards.color]?.let { put("color", it) }
            put("note", r[LoyaltyCards.note])
            r[LoyaltyCards.logoUrl]?.let { put("logoUrl", it) }
            r[LoyaltyCards.frontImageKey]?.let { put("frontImageKey", it) }
            r[LoyaltyCards.backImageKey]?.let { put("backImageKey", it) }
        },
    )

    // ═══════════════════════════════════════════════════════════════════
    // Sprint 5c.5 — Budgets / PlannedPayments / Debts / Goals / Warranties
    // / ShoppingLists+Items / MerchantRules / Investments / FioAccounts
    // ═══════════════════════════════════════════════════════════════════

    private fun Transaction.upsertBudget(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val existing = Budgets.selectAll().where { Budgets.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[Budgets.updatedAt] >= updatedAt) return UpsertResult.Conflict(budgetToEntity(existing, emptyMap(), emptyMap()))
            Budgets.update({ Budgets.syncId eq syncId }) { applyBudgetFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, categoryDbId, isInsert = false) }
        } else {
            Budgets.insert {
                it[Budgets.syncId] = syncId
                it[Budgets.createdAt] = updatedAt
                applyBudgetFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, categoryDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyBudgetFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, cid: UUID?, isInsert: Boolean) {
        if (isInsert) s[Budgets.profileId] = EntityID(pid, Profiles)
        s[Budgets.categoryId] = cid?.let { EntityID(it, Categories) }
        s[Budgets.name] = d.str("name")
        s[Budgets.limitAmount] = d.decimalOr("limit", BigDecimal.ZERO)
        s[Budgets.period] = d.strOr("period", "MONTHLY")
        s[Budgets.currency] = d.strOr("currency", "CZK")
        s[Budgets.clientVersion] = cv; s[Budgets.updatedAt] = u; s[Budgets.deletedAt] = del
    }

    private fun Transaction.upsertPlannedPayment(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val accountDbId = resolveAccountDbId(e.data.strOrNull("accountId")) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId"))
        val existing = PlannedPayments.selectAll().where { PlannedPayments.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[PlannedPayments.updatedAt] >= updatedAt) return UpsertResult.Conflict(plannedPaymentToEntity(existing, emptyMap(), emptyMap(), emptyMap()))
            PlannedPayments.update({ PlannedPayments.syncId eq syncId }) { applyPlannedPaymentFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, accountDbId, categoryDbId, isInsert = false) }
        } else {
            PlannedPayments.insert {
                it[PlannedPayments.syncId] = syncId
                it[PlannedPayments.createdAt] = updatedAt
                applyPlannedPaymentFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, accountDbId, categoryDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyPlannedPaymentFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, aid: UUID, cid: UUID?, isInsert: Boolean) {
        if (isInsert) {
            s[PlannedPayments.profileId] = EntityID(pid, Profiles)
            s[PlannedPayments.accountId] = EntityID(aid, Accounts)
        }
        s[PlannedPayments.categoryId] = cid?.let { EntityID(it, Categories) }
        s[PlannedPayments.name] = d.str("name")
        s[PlannedPayments.amount] = d.decimalOr("amount", BigDecimal.ZERO)
        s[PlannedPayments.currency] = d.strOr("currency", "CZK")
        s[PlannedPayments.type] = d.strOr("type", "EXPENSE")
        s[PlannedPayments.period] = d.strOr("period", "MONTHLY")
        s[PlannedPayments.nextDate] = LocalDate.parse(d.strOr("nextDate", LocalDate.now().toString()))
        s[PlannedPayments.note] = d.strOr("note", "")
        s[PlannedPayments.isActive] = d.boolOr("isActive", true)
        s[PlannedPayments.clientVersion] = cv; s[PlannedPayments.updatedAt] = u; s[PlannedPayments.deletedAt] = del
    }

    private fun Transaction.upsertDebt(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Debts.selectAll().where { Debts.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[Debts.updatedAt] >= updatedAt) return UpsertResult.Conflict(debtToEntity(existing, emptyMap()))
            Debts.update({ Debts.syncId eq syncId }) { applyDebtFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false) }
        } else {
            Debts.insert {
                it[Debts.syncId] = syncId
                it[Debts.createdAt] = updatedAt
                applyDebtFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyDebtFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, isInsert: Boolean) {
        if (isInsert) s[Debts.profileId] = EntityID(pid, Profiles)
        s[Debts.personName] = d.str("personName")
        s[Debts.amount] = d.decimalOr("amount", BigDecimal.ZERO)
        s[Debts.currency] = d.strOr("currency", "CZK")
        s[Debts.type] = d.strOr("type", "BORROWED")
        s[Debts.description] = d.strOr("description", "")
        s[Debts.dueDate] = d.strOrNull("dueDate")?.let { LocalDate.parse(it) }
        s[Debts.isPaid] = d.boolOr("isPaid", false)
        s[Debts.createdDate] = LocalDate.parse(d.strOr("createdDate", LocalDate.now().toString()))
        s[Debts.clientVersion] = cv; s[Debts.updatedAt] = u; s[Debts.deletedAt] = del
    }

    private fun Transaction.upsertGoal(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Goals.selectAll().where { Goals.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[Goals.updatedAt] >= updatedAt) return UpsertResult.Conflict(goalToEntity(existing, emptyMap()))
            Goals.update({ Goals.syncId eq syncId }) { applyGoalFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false) }
        } else {
            Goals.insert {
                it[Goals.syncId] = syncId
                it[Goals.createdAt] = updatedAt
                applyGoalFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyGoalFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, isInsert: Boolean) {
        if (isInsert) s[Goals.profileId] = EntityID(pid, Profiles)
        s[Goals.name] = d.str("name")
        s[Goals.targetAmount] = d.decimalOr("targetAmount", BigDecimal.ZERO)
        s[Goals.currentAmount] = d.decimalOr("currentAmount", BigDecimal.ZERO)
        s[Goals.currency] = d.strOr("currency", "CZK")
        s[Goals.color] = d.intOrNull("color")
        s[Goals.deadline] = d.strOrNull("deadline")?.let { LocalDate.parse(it) }
        s[Goals.note] = d.strOr("note", "")
        s[Goals.clientVersion] = cv; s[Goals.updatedAt] = u; s[Goals.deletedAt] = del
    }

    private fun Transaction.upsertWarranty(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = Warranties.selectAll().where { Warranties.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[Warranties.updatedAt] >= updatedAt) return UpsertResult.Conflict(warrantyToEntity(existing, emptyMap()))
            Warranties.update({ Warranties.syncId eq syncId }) { applyWarrantyFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false) }
        } else {
            Warranties.insert {
                it[Warranties.syncId] = syncId
                it[Warranties.createdAt] = updatedAt
                applyWarrantyFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyWarrantyFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, isInsert: Boolean) {
        if (isInsert) s[Warranties.profileId] = EntityID(pid, Profiles)
        s[Warranties.productName] = d.str("productName")
        s[Warranties.shop] = d.strOr("shop", "")
        s[Warranties.purchaseDate] = LocalDate.parse(d.strOr("purchaseDate", LocalDate.now().toString()))
        s[Warranties.warrantyYears] = d.intOr("warrantyYears", 2)
        s[Warranties.price] = d.decimalOrNull("price")
        s[Warranties.currency] = d.strOr("currency", "CZK")
        s[Warranties.note] = d.strOr("note", "")
        s[Warranties.receiptImageKey] = d.strOrNull("receiptImageKey")
        s[Warranties.clientVersion] = cv; s[Warranties.updatedAt] = u; s[Warranties.deletedAt] = del
    }

    private fun Transaction.upsertShoppingList(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val existing = ShoppingLists.selectAll().where { ShoppingLists.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[ShoppingLists.updatedAt] >= updatedAt) return UpsertResult.Conflict(shoppingListToEntity(existing, emptyMap()))
            ShoppingLists.update({ ShoppingLists.syncId eq syncId }) { applyShoppingListFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = false) }
        } else {
            ShoppingLists.insert {
                it[ShoppingLists.syncId] = syncId
                it[ShoppingLists.createdAt] = updatedAt
                applyShoppingListFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyShoppingListFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, isInsert: Boolean) {
        if (isInsert) s[ShoppingLists.profileId] = EntityID(pid, Profiles)
        s[ShoppingLists.name] = d.str("name")
        s[ShoppingLists.color] = d.intOr("color", 0)
        s[ShoppingLists.clientVersion] = cv; s[ShoppingLists.updatedAt] = u; s[ShoppingLists.deletedAt] = del
    }

    private fun Transaction.upsertShoppingItem(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val listSyncStr = e.data.str("listId")
        val listSync = runCatching { UUID.fromString(listSyncStr) }.getOrNull() ?: return UpsertResult.Forbidden
        val listRow = ShoppingLists.selectAll().where { ShoppingLists.syncId eq listSync }.singleOrNull() ?: return UpsertResult.Forbidden
        val profile = Profiles.selectAll().where { Profiles.id eq listRow[ShoppingLists.profileId].value }.singleOrNull() ?: return UpsertResult.Forbidden
        if (!canWriteProfile(userId, profile)) return UpsertResult.Forbidden
        val listDbId = listRow[ShoppingLists.id].value

        val existing = ShoppingItems.selectAll().where { ShoppingItems.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[ShoppingItems.updatedAt] >= updatedAt) return UpsertResult.Conflict(shoppingItemToEntity(existing, mapOf(listDbId to listSync)))
            ShoppingItems.update({ ShoppingItems.syncId eq syncId }) { applyShoppingItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, listDbId, isInsert = false) }
        } else {
            ShoppingItems.insert {
                it[ShoppingItems.syncId] = syncId
                it[ShoppingItems.createdAt] = updatedAt
                applyShoppingItemFields(it, e.data, e.clientVersion, updatedAt, deletedAt, listDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyShoppingItemFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, lid: UUID, isInsert: Boolean) {
        if (isInsert) s[ShoppingItems.listId] = EntityID(lid, ShoppingLists)
        s[ShoppingItems.name] = d.str("name")
        s[ShoppingItems.quantity] = d.strOr("quantity", "1")
        s[ShoppingItems.price] = d.decimalOrNull("price")
        s[ShoppingItems.isChecked] = d.boolOr("isChecked", false)
        s[ShoppingItems.clientVersion] = cv; s[ShoppingItems.updatedAt] = u; s[ShoppingItems.deletedAt] = del
    }

    private fun Transaction.upsertMerchantRule(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val categoryDbId = resolveCategoryDbId(e.data.strOrNull("categoryId")) ?: return UpsertResult.Forbidden
        val existing = MerchantRules.selectAll().where { MerchantRules.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[MerchantRules.updatedAt] >= updatedAt) return UpsertResult.Conflict(merchantRuleToEntity(existing, emptyMap(), emptyMap()))
            MerchantRules.update({ MerchantRules.syncId eq syncId }) { applyMerchantRuleFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, categoryDbId, isInsert = false) }
        } else {
            MerchantRules.insert {
                it[MerchantRules.syncId] = syncId
                it[MerchantRules.createdAt] = updatedAt
                applyMerchantRuleFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, categoryDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyMerchantRuleFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, cid: UUID, isInsert: Boolean) {
        if (isInsert) {
            s[MerchantRules.profileId] = EntityID(pid, Profiles)
            s[MerchantRules.categoryId] = EntityID(cid, Categories)
        }
        s[MerchantRules.keyword] = d.str("keyword")
        s[MerchantRules.createdAtStr] = d.strOr("createdAt", "")
        s[MerchantRules.clientVersion] = cv; s[MerchantRules.updatedAt] = u; s[MerchantRules.deletedAt] = del
    }

    private fun Transaction.upsertInvestmentPosition(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val accountDbId = resolveAccountDbId(e.data.strOrNull("accountId")) ?: return UpsertResult.Forbidden
        val existing = InvestmentPositions.selectAll().where { InvestmentPositions.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[InvestmentPositions.updatedAt] >= updatedAt) return UpsertResult.Conflict(investmentPositionToEntity(existing, emptyMap(), emptyMap()))
            InvestmentPositions.update({ InvestmentPositions.syncId eq syncId }) { applyInvestmentFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, accountDbId, isInsert = false) }
        } else {
            InvestmentPositions.insert {
                it[InvestmentPositions.syncId] = syncId
                it[InvestmentPositions.createdAt] = updatedAt
                applyInvestmentFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, accountDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyInvestmentFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, aid: UUID, isInsert: Boolean) {
        if (isInsert) {
            s[InvestmentPositions.profileId] = EntityID(pid, Profiles)
            s[InvestmentPositions.accountId] = EntityID(aid, Accounts)
        }
        s[InvestmentPositions.symbol] = d.str("symbol")
        s[InvestmentPositions.name] = d.str("name")
        s[InvestmentPositions.quantity] = d.decimalOr("quantity", BigDecimal.ZERO)
        s[InvestmentPositions.buyPrice] = d.decimalOr("buyPrice", BigDecimal.ZERO)
        s[InvestmentPositions.buyCurrency] = d.strOr("buyCurrency", "CZK")
        s[InvestmentPositions.buyDate] = d.strOr("buyDate", "")
        s[InvestmentPositions.platform] = d.strOr("platform", "")
        s[InvestmentPositions.isOpen] = d.boolOr("isOpen", true)
        s[InvestmentPositions.sellPrice] = d.decimalOrNull("sellPrice")
        s[InvestmentPositions.sellDate] = d.strOrNull("sellDate")
        s[InvestmentPositions.yahooSymbol] = d.strOrNull("yahooSymbol")
        s[InvestmentPositions.notes] = d.strOrNull("notes")
        s[InvestmentPositions.clientVersion] = cv; s[InvestmentPositions.updatedAt] = u; s[InvestmentPositions.deletedAt] = del
    }

    private fun Transaction.upsertFioAccount(userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?): UpsertResult {
        val profileDbId = resolveProfileDbId(e.data.str("profileId"), userId) ?: return UpsertResult.Forbidden
        val linkedAccountDbId = resolveAccountDbId(e.data.strOrNull("linkedAccountId"))
        val existing = FioAccounts.selectAll().where { FioAccounts.syncId eq syncId }.singleOrNull()
        if (existing != null) {
            if (existing[FioAccounts.updatedAt] >= updatedAt) return UpsertResult.Conflict(fioAccountToEntity(existing, emptyMap(), emptyMap()))
            FioAccounts.update({ FioAccounts.syncId eq syncId }) { applyFioAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, linkedAccountDbId, isInsert = false) }
        } else {
            FioAccounts.insert {
                it[FioAccounts.syncId] = syncId
                it[FioAccounts.createdAt] = updatedAt
                applyFioAccountFields(it, e.data, e.clientVersion, updatedAt, deletedAt, profileDbId, linkedAccountDbId, isInsert = true)
            }
        }
        return UpsertResult.Accepted
    }

    private fun applyFioAccountFields(s: UpdateBuilder<*>, d: JsonObject, cv: Long, u: Instant, del: Instant?, pid: UUID, lid: UUID?, isInsert: Boolean) {
        if (isInsert) s[FioAccounts.profileId] = EntityID(pid, Profiles)
        s[FioAccounts.name] = d.str("name")
        s[FioAccounts.linkedAccountId] = lid?.let { EntityID(it, Accounts) }
        s[FioAccounts.lastSync] = d.strOrNull("lastSync")
        s[FioAccounts.isEnabled] = d.boolOr("isEnabled", true)
        s[FioAccounts.clientVersion] = cv; s[FioAccounts.updatedAt] = u; s[FioAccounts.deletedAt] = del
    }

    // ─── Mappers: ResultRow → SyncEntity ─────────────────────────────

    private fun budgetToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>, categoryIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Budgets.syncId].toString(),
        updatedAt = r[Budgets.updatedAt].toString(),
        deletedAt = r[Budgets.deletedAt]?.toString(),
        clientVersion = r[Budgets.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Budgets.profileId].value] ?: r[Budgets.profileId].value).toString())
            r[Budgets.categoryId]?.let { put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString()) }
            put("name", r[Budgets.name])
            put("limit", r[Budgets.limitAmount].toPlainString())
            put("period", r[Budgets.period])
            put("currency", r[Budgets.currency])
        },
    )

    private fun plannedPaymentToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>, accountIdToSync: Map<UUID, UUID>, categoryIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[PlannedPayments.syncId].toString(),
        updatedAt = r[PlannedPayments.updatedAt].toString(),
        deletedAt = r[PlannedPayments.deletedAt]?.toString(),
        clientVersion = r[PlannedPayments.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[PlannedPayments.profileId].value] ?: r[PlannedPayments.profileId].value).toString())
            put("accountId", (accountIdToSync[r[PlannedPayments.accountId].value] ?: r[PlannedPayments.accountId].value).toString())
            r[PlannedPayments.categoryId]?.let { put("categoryId", (categoryIdToSync[it.value] ?: it.value).toString()) }
            put("name", r[PlannedPayments.name])
            put("amount", r[PlannedPayments.amount].toPlainString())
            put("currency", r[PlannedPayments.currency])
            put("type", r[PlannedPayments.type])
            put("period", r[PlannedPayments.period])
            put("nextDate", r[PlannedPayments.nextDate].toString())
            put("note", r[PlannedPayments.note])
            put("isActive", r[PlannedPayments.isActive])
        },
    )

    private fun debtToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Debts.syncId].toString(),
        updatedAt = r[Debts.updatedAt].toString(),
        deletedAt = r[Debts.deletedAt]?.toString(),
        clientVersion = r[Debts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Debts.profileId].value] ?: r[Debts.profileId].value).toString())
            put("personName", r[Debts.personName])
            put("amount", r[Debts.amount].toPlainString())
            put("currency", r[Debts.currency])
            put("type", r[Debts.type])
            put("description", r[Debts.description])
            r[Debts.dueDate]?.let { put("dueDate", it.toString()) }
            put("isPaid", r[Debts.isPaid])
            put("createdDate", r[Debts.createdDate].toString())
        },
    )

    private fun goalToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Goals.syncId].toString(),
        updatedAt = r[Goals.updatedAt].toString(),
        deletedAt = r[Goals.deletedAt]?.toString(),
        clientVersion = r[Goals.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Goals.profileId].value] ?: r[Goals.profileId].value).toString())
            put("name", r[Goals.name])
            put("targetAmount", r[Goals.targetAmount].toPlainString())
            put("currentAmount", r[Goals.currentAmount].toPlainString())
            put("currency", r[Goals.currency])
            r[Goals.color]?.let { put("color", it) }
            r[Goals.deadline]?.let { put("deadline", it.toString()) }
            put("note", r[Goals.note])
        },
    )

    private fun warrantyToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[Warranties.syncId].toString(),
        updatedAt = r[Warranties.updatedAt].toString(),
        deletedAt = r[Warranties.deletedAt]?.toString(),
        clientVersion = r[Warranties.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[Warranties.profileId].value] ?: r[Warranties.profileId].value).toString())
            put("productName", r[Warranties.productName])
            put("shop", r[Warranties.shop])
            put("purchaseDate", r[Warranties.purchaseDate].toString())
            put("warrantyYears", r[Warranties.warrantyYears])
            r[Warranties.price]?.let { put("price", it.toPlainString()) }
            put("currency", r[Warranties.currency])
            put("note", r[Warranties.note])
            r[Warranties.receiptImageKey]?.let { put("receiptImageKey", it) }
        },
    )

    private fun shoppingListToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[ShoppingLists.syncId].toString(),
        updatedAt = r[ShoppingLists.updatedAt].toString(),
        deletedAt = r[ShoppingLists.deletedAt]?.toString(),
        clientVersion = r[ShoppingLists.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[ShoppingLists.profileId].value] ?: r[ShoppingLists.profileId].value).toString())
            put("name", r[ShoppingLists.name])
            put("color", r[ShoppingLists.color])
        },
    )

    private fun shoppingItemToEntity(r: ResultRow, listIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[ShoppingItems.syncId].toString(),
        updatedAt = r[ShoppingItems.updatedAt].toString(),
        deletedAt = r[ShoppingItems.deletedAt]?.toString(),
        clientVersion = r[ShoppingItems.clientVersion],
        data = buildJsonObject {
            put("listId", (listIdToSync[r[ShoppingItems.listId].value] ?: r[ShoppingItems.listId].value).toString())
            put("name", r[ShoppingItems.name])
            put("quantity", r[ShoppingItems.quantity])
            r[ShoppingItems.price]?.let { put("price", it.toPlainString()) }
            put("isChecked", r[ShoppingItems.isChecked])
        },
    )

    private fun merchantRuleToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>, categoryIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[MerchantRules.syncId].toString(),
        updatedAt = r[MerchantRules.updatedAt].toString(),
        deletedAt = r[MerchantRules.deletedAt]?.toString(),
        clientVersion = r[MerchantRules.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[MerchantRules.profileId].value] ?: r[MerchantRules.profileId].value).toString())
            put("categoryId", (categoryIdToSync[r[MerchantRules.categoryId].value] ?: r[MerchantRules.categoryId].value).toString())
            put("keyword", r[MerchantRules.keyword])
            put("createdAt", r[MerchantRules.createdAtStr])
        },
    )

    private fun investmentPositionToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>, accountIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[InvestmentPositions.syncId].toString(),
        updatedAt = r[InvestmentPositions.updatedAt].toString(),
        deletedAt = r[InvestmentPositions.deletedAt]?.toString(),
        clientVersion = r[InvestmentPositions.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[InvestmentPositions.profileId].value] ?: r[InvestmentPositions.profileId].value).toString())
            put("accountId", (accountIdToSync[r[InvestmentPositions.accountId].value] ?: r[InvestmentPositions.accountId].value).toString())
            put("symbol", r[InvestmentPositions.symbol])
            put("name", r[InvestmentPositions.name])
            put("quantity", r[InvestmentPositions.quantity].toPlainString())
            put("buyPrice", r[InvestmentPositions.buyPrice].toPlainString())
            put("buyCurrency", r[InvestmentPositions.buyCurrency])
            put("buyDate", r[InvestmentPositions.buyDate])
            put("platform", r[InvestmentPositions.platform])
            put("isOpen", r[InvestmentPositions.isOpen])
            r[InvestmentPositions.sellPrice]?.let { put("sellPrice", it.toPlainString()) }
            r[InvestmentPositions.sellDate]?.let { put("sellDate", it) }
            r[InvestmentPositions.yahooSymbol]?.let { put("yahooSymbol", it) }
            r[InvestmentPositions.notes]?.let { put("notes", it) }
        },
    )

    private fun fioAccountToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>, accountIdToSync: Map<UUID, UUID>) = SyncEntity(
        syncId = r[FioAccounts.syncId].toString(),
        updatedAt = r[FioAccounts.updatedAt].toString(),
        deletedAt = r[FioAccounts.deletedAt]?.toString(),
        clientVersion = r[FioAccounts.clientVersion],
        data = buildJsonObject {
            put("profileId", (profileIdToSync[r[FioAccounts.profileId].value] ?: r[FioAccounts.profileId].value).toString())
            put("name", r[FioAccounts.name])
            r[FioAccounts.linkedAccountId]?.let { put("linkedAccountId", (accountIdToSync[it.value] ?: it.value).toString()) }
            r[FioAccounts.lastSync]?.let { put("lastSync", it) }
            put("isEnabled", r[FioAccounts.isEnabled])
        },
    )
}

// ═══════════════════════════════════════════════════════════════════════
// JsonObject extension helpers
// ═══════════════════════════════════════════════════════════════════════

private fun JsonObject.str(key: String): String =
    get(key)?.jsonPrimitive?.contentOrNull
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí pole '$key' v entity.data.")

private fun JsonObject.strOrNull(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
private fun JsonObject.strOr(key: String, default: String): String = get(key)?.jsonPrimitive?.contentOrNull ?: default
private fun JsonObject.intOrNull(key: String): Int? = get(key)?.jsonPrimitive?.intOrNull
private fun JsonObject.intOr(key: String, default: Int): Int = get(key)?.jsonPrimitive?.intOrNull ?: default
private fun JsonObject.bool(key: String): Boolean = get(key)?.jsonPrimitive?.booleanOrNull
    ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí bool '$key'.")
private fun JsonObject.boolOr(key: String, default: Boolean): Boolean = get(key)?.jsonPrimitive?.booleanOrNull ?: default
private fun JsonObject.uuidOrNull(key: String): UUID? = get(key)?.jsonPrimitive?.contentOrNull?.let { UUID.fromString(it) }
private fun JsonObject.decimal(key: String): BigDecimal =
    get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) }
        ?: throw ApiException(HttpStatusCode.BadRequest, "missing_field", "Chybí decimal '$key'.")
private fun JsonObject.decimalOrNull(key: String): BigDecimal? = get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) }
private fun JsonObject.decimalOr(key: String, default: BigDecimal): BigDecimal =
    get(key)?.jsonPrimitive?.contentOrNull?.let { BigDecimal(it) } ?: default

// ═══════════════════════════════════════════════════════════════════
// Sprint 5g.2.d — skupinove entity (group_members, group_expenses, items)
// ═══════════════════════════════════════════════════════════════════

private fun SyncService.groupMemberToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
    syncId = r[GroupMembers.syncId].toString(),
    updatedAt = r[GroupMembers.updatedAt].toString(),
    deletedAt = r[GroupMembers.deletedAt]?.toString(),
    clientVersion = r[GroupMembers.clientVersion],
    data = buildJsonObject {
        put("profileId", (profileIdToSync[r[GroupMembers.profileId].value] ?: UUID.randomUUID()).toString())
        put("name", r[GroupMembers.name])
        put("color", r[GroupMembers.color])
        r[GroupMembers.cointrackUserId]?.value?.let { put("cointrackUserId", it.toString()) }
    },
)

private fun SyncService.groupExpenseToEntity(r: ResultRow, profileIdToSync: Map<UUID, UUID>) = SyncEntity(
    syncId = r[GroupExpenses.syncId].toString(),
    updatedAt = r[GroupExpenses.updatedAt].toString(),
    deletedAt = r[GroupExpenses.deletedAt]?.toString(),
    clientVersion = r[GroupExpenses.clientVersion],
    data = buildJsonObject {
        put("profileId", (profileIdToSync[r[GroupExpenses.profileId].value] ?: UUID.randomUUID()).toString())
        put("description", r[GroupExpenses.description])
        put("amount", r[GroupExpenses.amount].toPlainString())
        put("currency", r[GroupExpenses.currency])
        put("paidByMemberSyncId", r[GroupExpenses.paidByMemberSyncId].toString())
        put("defaultParticipantSyncIds", r[GroupExpenses.defaultParticipantSyncIds])
        put("date", r[GroupExpenses.date].toString())
        r[GroupExpenses.note]?.let { put("note", it) }
        put("isSettlement", r[GroupExpenses.isSettlement])
    },
)

private fun SyncService.groupExpenseItemToEntity(r: ResultRow, expenseIdToSync: Map<UUID, UUID>) = SyncEntity(
    syncId = r[GroupExpenseItems.syncId].toString(),
    updatedAt = r[GroupExpenseItems.updatedAt].toString(),
    deletedAt = r[GroupExpenseItems.deletedAt]?.toString(),
    clientVersion = r[GroupExpenseItems.clientVersion],
    data = buildJsonObject {
        put("expenseId", (expenseIdToSync[r[GroupExpenseItems.expenseId].value] ?: UUID.randomUUID()).toString())
        put("name", r[GroupExpenseItems.name])
        put("amount", r[GroupExpenseItems.amount].toPlainString())
        put("participantSyncIds", r[GroupExpenseItems.participantSyncIds])
        put("position", r[GroupExpenseItems.position])
    },
)

// ─── Upserts ─────────────────────────────────────────────────────

private fun Transaction.upsertGroupMember(
    userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
): UpsertResult {
    val profileSyncId = e.data.str("profileId")
    val profileRow = Profiles.selectAll().where {
        Profiles.syncId eq UUID.fromString(profileSyncId)
    }.singleOrNull() ?: return UpsertResult.Forbidden

    // Inline canWrite check (SyncService private method — use direct logic)
    val canWrite = profileRow[Profiles.ownerUserId].value == userId ||
        run {
            val orgId = profileRow[Profiles.organizationId]?.value
            if (orgId == null) false
            else OrganizationMembers.selectAll().where {
                (OrganizationMembers.organizationId eq orgId) and
                    (OrganizationMembers.userId eq userId)
            }.any()
        }
    if (!canWrite) return UpsertResult.Forbidden

    val profileDbId = profileRow[Profiles.id].value
    val existing = GroupMembers.selectAll().where { GroupMembers.syncId eq syncId }.singleOrNull()
    if (existing != null) {
        if (existing[GroupMembers.updatedAt] >= updatedAt) {
            return UpsertResult.Conflict(existingGroupMemberEntity(existing))
        }
        GroupMembers.update({ GroupMembers.syncId eq syncId }) {
            it[GroupMembers.name] = e.data.str("name")
            it[GroupMembers.color] = e.data.get("color")?.jsonPrimitive?.intOrNull ?: -13022129
            it[GroupMembers.cointrackUserId] = e.data.uuidOrNull("cointrackUserId")?.let { EntityID(it, Users) }
            it[GroupMembers.clientVersion] = e.clientVersion
            it[GroupMembers.updatedAt] = updatedAt
            it[GroupMembers.deletedAt] = deletedAt
        }
    } else {
        GroupMembers.insert {
            it[GroupMembers.syncId] = syncId
            it[GroupMembers.profileId] = EntityID(profileDbId, Profiles)
            it[GroupMembers.name] = e.data.str("name")
            it[GroupMembers.color] = e.data.get("color")?.jsonPrimitive?.intOrNull ?: -13022129
            it[GroupMembers.cointrackUserId] = e.data.uuidOrNull("cointrackUserId")?.let { EntityID(it, Users) }
            it[GroupMembers.clientVersion] = e.clientVersion
            it[GroupMembers.createdAt] = updatedAt
            it[GroupMembers.updatedAt] = updatedAt
            it[GroupMembers.deletedAt] = deletedAt
        }
    }
    return UpsertResult.Accepted
}

private fun Transaction.existingGroupMemberEntity(r: ResultRow): SyncEntity {
    val profileSyncId = Profiles.selectAll().where { Profiles.id eq r[GroupMembers.profileId].value }
        .singleOrNull()?.get(Profiles.syncId) ?: UUID.randomUUID()
    return SyncEntity(
        syncId = r[GroupMembers.syncId].toString(),
        updatedAt = r[GroupMembers.updatedAt].toString(),
        deletedAt = r[GroupMembers.deletedAt]?.toString(),
        clientVersion = r[GroupMembers.clientVersion],
        data = buildJsonObject {
            put("profileId", profileSyncId.toString())
            put("name", r[GroupMembers.name])
            put("color", r[GroupMembers.color])
            r[GroupMembers.cointrackUserId]?.value?.let { put("cointrackUserId", it.toString()) }
        },
    )
}

private fun Transaction.upsertGroupExpense(
    userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
): UpsertResult {
    val profileSyncId = UUID.fromString(e.data.str("profileId"))
    val profileRow = Profiles.selectAll().where { Profiles.syncId eq profileSyncId }.singleOrNull()
        ?: return UpsertResult.Forbidden

    val canWrite = profileRow[Profiles.ownerUserId].value == userId ||
        run {
            val orgId = profileRow[Profiles.organizationId]?.value ?: return@run false
            OrganizationMembers.selectAll().where {
                (OrganizationMembers.organizationId eq orgId) and (OrganizationMembers.userId eq userId)
            }.any()
        }
    if (!canWrite) return UpsertResult.Forbidden

    val profileDbId = profileRow[Profiles.id].value
    val existing = GroupExpenses.selectAll().where { GroupExpenses.syncId eq syncId }.singleOrNull()
    if (existing != null && existing[GroupExpenses.updatedAt] >= updatedAt) {
        return UpsertResult.Conflict(existingGroupExpenseEntity(existing))
    }
    val apply: UpdateBuilder<*>.() -> Unit = {
        this[GroupExpenses.description] = e.data.str("description")
        this[GroupExpenses.amount] = e.data.decimal("amount")
        this[GroupExpenses.currency] = e.data.strOr("currency", "CZK")
        this[GroupExpenses.paidByMemberSyncId] = UUID.fromString(e.data.str("paidByMemberSyncId"))
        this[GroupExpenses.defaultParticipantSyncIds] = e.data.strOr("defaultParticipantSyncIds", "[]")
        this[GroupExpenses.date] = LocalDate.parse(e.data.str("date"))
        this[GroupExpenses.note] = e.data.strOrNull("note")
        this[GroupExpenses.isSettlement] = e.data.boolOr("isSettlement", false)
        this[GroupExpenses.clientVersion] = e.clientVersion
        this[GroupExpenses.updatedAt] = updatedAt
        this[GroupExpenses.deletedAt] = deletedAt
    }
    if (existing != null) {
        GroupExpenses.update({ GroupExpenses.syncId eq syncId }) { apply(it) }
    } else {
        GroupExpenses.insert {
            it[GroupExpenses.syncId] = syncId
            it[GroupExpenses.profileId] = EntityID(profileDbId, Profiles)
            it[GroupExpenses.createdAt] = updatedAt
            apply(it)
        }
    }
    return UpsertResult.Accepted
}

private fun Transaction.existingGroupExpenseEntity(r: ResultRow): SyncEntity {
    val profileSync = Profiles.selectAll().where { Profiles.id eq r[GroupExpenses.profileId].value }
        .singleOrNull()?.get(Profiles.syncId) ?: UUID.randomUUID()
    return SyncEntity(
        syncId = r[GroupExpenses.syncId].toString(),
        updatedAt = r[GroupExpenses.updatedAt].toString(),
        deletedAt = r[GroupExpenses.deletedAt]?.toString(),
        clientVersion = r[GroupExpenses.clientVersion],
        data = buildJsonObject {
            put("profileId", profileSync.toString())
            put("description", r[GroupExpenses.description])
            put("amount", r[GroupExpenses.amount].toPlainString())
            put("currency", r[GroupExpenses.currency])
            put("paidByMemberSyncId", r[GroupExpenses.paidByMemberSyncId].toString())
            put("defaultParticipantSyncIds", r[GroupExpenses.defaultParticipantSyncIds])
            put("date", r[GroupExpenses.date].toString())
            r[GroupExpenses.note]?.let { put("note", it) }
            put("isSettlement", r[GroupExpenses.isSettlement])
        },
    )
}

private fun Transaction.upsertGroupExpenseItem(
    userId: UUID, syncId: UUID, e: SyncEntity, updatedAt: Instant, deletedAt: Instant?
): UpsertResult {
    val expenseSyncId = UUID.fromString(e.data.str("expenseId"))
    val expenseRow = GroupExpenses.selectAll().where { GroupExpenses.syncId eq expenseSyncId }.singleOrNull()
        ?: return UpsertResult.Forbidden

    // Auth: user musí mít přístup k profilu expense
    val profileRow = Profiles.selectAll().where { Profiles.id eq expenseRow[GroupExpenses.profileId].value }
        .singleOrNull() ?: return UpsertResult.Forbidden
    val canWrite = profileRow[Profiles.ownerUserId].value == userId ||
        run {
            val orgId = profileRow[Profiles.organizationId]?.value ?: return@run false
            OrganizationMembers.selectAll().where {
                (OrganizationMembers.organizationId eq orgId) and (OrganizationMembers.userId eq userId)
            }.any()
        }
    if (!canWrite) return UpsertResult.Forbidden

    val expenseDbId = expenseRow[GroupExpenses.id].value
    val existing = GroupExpenseItems.selectAll().where { GroupExpenseItems.syncId eq syncId }.singleOrNull()
    if (existing != null && existing[GroupExpenseItems.updatedAt] >= updatedAt) {
        return UpsertResult.Conflict(SyncEntity(
            syncId = existing[GroupExpenseItems.syncId].toString(),
            updatedAt = existing[GroupExpenseItems.updatedAt].toString(),
            deletedAt = existing[GroupExpenseItems.deletedAt]?.toString(),
            clientVersion = existing[GroupExpenseItems.clientVersion],
            data = buildJsonObject {
                put("expenseId", expenseSyncId.toString())
                put("name", existing[GroupExpenseItems.name])
                put("amount", existing[GroupExpenseItems.amount].toPlainString())
                put("participantSyncIds", existing[GroupExpenseItems.participantSyncIds])
                put("position", existing[GroupExpenseItems.position])
            },
        ))
    }
    val apply: UpdateBuilder<*>.() -> Unit = {
        this[GroupExpenseItems.name] = e.data.str("name")
        this[GroupExpenseItems.amount] = e.data.decimal("amount")
        this[GroupExpenseItems.participantSyncIds] = e.data.strOr("participantSyncIds", "[]")
        this[GroupExpenseItems.position] = e.data.get("position")?.jsonPrimitive?.intOrNull ?: 0
        this[GroupExpenseItems.clientVersion] = e.clientVersion
        this[GroupExpenseItems.updatedAt] = updatedAt
        this[GroupExpenseItems.deletedAt] = deletedAt
    }
    if (existing != null) {
        GroupExpenseItems.update({ GroupExpenseItems.syncId eq syncId }) { apply(it) }
    } else {
        GroupExpenseItems.insert {
            it[GroupExpenseItems.syncId] = syncId
            it[GroupExpenseItems.expenseId] = EntityID(expenseDbId, GroupExpenses)
            it[GroupExpenseItems.createdAt] = updatedAt
            apply(it)
        }
    }
    return UpsertResult.Accepted
}

internal sealed class UpsertResult {
    object Accepted : UpsertResult()
    object Forbidden : UpsertResult()
    data class Conflict(val serverEntity: SyncEntity) : UpsertResult()
}

typealias UpdateBuilder<T> = org.jetbrains.exposed.sql.statements.UpdateBuilder<T>
