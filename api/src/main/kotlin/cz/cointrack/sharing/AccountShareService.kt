package cz.cointrack.sharing

import cz.cointrack.auth.TokenGenerator
import cz.cointrack.db.AccountShares
import cz.cointrack.db.Accounts
import cz.cointrack.db.Profiles
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.email.EmailService
import cz.cointrack.email.EmailTemplates
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.lowerCase
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Per-account sharing pro Organization tier.
 *
 * Workflow:
 * 1. Vlastník účtu pozve email → vytvoří se row v `account_shares` s `invite_token`
 *    a vystavený email s odkazem `/accept-share?token=...`
 * 2. Pozvaný klikne odkaz → frontend zavolá `/shares/accept` s tokenem
 * 3. Backend match emailem → nastaví `user_id`, `accepted_at`, `invite_token = null`
 * 4. Sync od té chvíle vrací sdílený účet + napojené entity i pozvanému
 */
class AccountShareService(
    private val email: EmailService? = null,
    private val webBaseUrl: String,
) {
    private val log = LoggerFactory.getLogger(AccountShareService::class.java)

    @Serializable
    data class InviteRequest(
        val email: String,
        val role: String = "VIEWER",  // VIEWER | EDITOR | ACCOUNTANT
        /** Vidí pozvaný příjmy? Default ano. */
        val visibilityIncome: Boolean = true,
        /** Vidí pozvaný výdaje? Default ano. */
        val visibilityExpenses: Boolean = true,
        /** Whitelist kategorií (syncId UUID). Null = bez omezení. Empty list = nic neuvidí. */
        val visibilityCategories: List<String>? = null,
    )

    @Serializable
    data class UpdateShareRequest(
        val role: String? = null,
        val visibilityIncome: Boolean? = null,
        val visibilityExpenses: Boolean? = null,
        /**
         * `null` jako hodnota fieldu = neaktualizovat (= zachovat existing).
         * Pro reset filtru pošli prázdný prefix "__none__"? Hmm, raději přidat
         * separate flag. Pro teď: pokud klient pošle "[]" nebo neposlal nic,
         * neměníme. Klient ovládá explicit "set to null" přes resetVisibilityCategories.
         */
        val visibilityCategories: List<String>? = null,
        /** True = `visibilityCategories` se má nastavit na NULL (= žádný filter). */
        val resetVisibilityCategories: Boolean = false,
    )

    @Serializable
    data class ShareDto(
        val id: String,
        val accountId: String,
        val email: String,
        val role: String,
        val status: String,           // pending | active | revoked
        val acceptedAt: String? = null,
        val createdAt: String,
        val userDisplayName: String? = null,
        val visibilityIncome: Boolean = true,
        val visibilityExpenses: Boolean = true,
        val visibilityCategories: List<String>? = null,
    )

    @Serializable
    data class AccountInfo(
        val accountId: String,
        val name: String,
        val currency: String,
        val profileId: String,
        val profileName: String,
    )

    @Serializable
    data class ShareWithAccountDto(
        val id: String,
        val accountId: String,
        val accountSyncId: String,
        val accountName: String,
        val accountCurrency: String,
        val profileSyncId: String,
        val profileName: String,
        val email: String,
        val role: String,
        val status: String,
        val acceptedAt: String? = null,
        val createdAt: String,
        val userDisplayName: String? = null,
        val visibilityIncome: Boolean = true,
        val visibilityExpenses: Boolean = true,
        val visibilityCategories: List<String>? = null,
    )

    companion object {
        private val categoriesJson = Json { ignoreUnknownKeys = true }
        private val categoriesSerializer = ListSerializer(String.serializer())

        internal fun parseCategoryFilter(raw: String?): List<String>? = raw?.let {
            runCatching { categoriesJson.decodeFromString(categoriesSerializer, it) }.getOrNull()
        }

        internal fun encodeCategoryFilter(list: List<String>?): String? = list?.let {
            categoriesJson.encodeToString(categoriesSerializer, it)
        }
    }

    @Serializable
    data class InvitePreview(
        val ownerEmail: String,
        val accountName: String,
        val profileName: String,
        val role: String,
        val expiresAt: String?,
    )

    /**
     * Pozve email pro daný účet.
     * @param accountSyncId — sync_id z klientské strany (mobil + web posílají syncId)
     */
    suspend fun inviteEmail(
        accountSyncId: UUID,
        ownerUserId: UUID,
        req: InviteRequest,
    ): ShareDto {
        val normalizedEmail = req.email.trim().lowercase()
        if (normalizedEmail.isBlank() || !normalizedEmail.contains("@")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_email", "Neplatný email.")
        }
        if (req.role !in setOf("VIEWER", "EDITOR", "ACCOUNTANT")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_role",
                "Role musí být VIEWER, EDITOR nebo ACCOUNTANT.")
        }

        // Tier check — jen BUSINESS_PRO může sdílet účty (legacy ORGANIZATION
        // ze starší DB hodnoty stále akceptujeme; V24 migrace většinu přepsala).
        val ownerTier = db {
            Users.selectAll().where { Users.id eq ownerUserId }.singleOrNull()?.get(Users.tier)
        }
        if (ownerTier != "BUSINESS_PRO" && ownerTier != "ORGANIZATION") {
            throw ApiException(HttpStatusCode.PaymentRequired, "tier_required",
                "Sdílení účtů vyžaduje předplatné Business Pro.")
        }

        // Verify account ownership; klient pošle syncId, mapujeme ho na DB id
        data class AccLookup(val id: UUID, val name: String, val profileName: String)
        val lookup = db {
            val acc = Accounts.selectAll().where { Accounts.syncId eq accountSyncId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found",
                    "Účet nenalezen (syncId=$accountSyncId).")
            val profileId = acc[Accounts.profileId].value
            val profile = Profiles.selectAll().where { Profiles.id eq profileId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
            if (profile[Profiles.ownerUserId].value != ownerUserId) {
                throw ApiException(HttpStatusCode.Forbidden, "not_owner",
                    "Nejsi vlastníkem tohoto účtu.")
            }
            AccLookup(acc[Accounts.id].value, acc[Accounts.name], profile[Profiles.name])
        }
        val accountId = lookup.id
        val accountName = lookup.name
        val profileName = lookup.profileName

        // Self-invite check
        val ownerEmail = db {
            Users.selectAll().where { Users.id eq ownerUserId }.singleOrNull()?.get(Users.email)?.lowercase()
        }
        if (ownerEmail == normalizedEmail) {
            throw ApiException(HttpStatusCode.BadRequest, "self_invite",
                "Sdílení sám sobě nedává smysl.")
        }

        val now = Instant.now()
        val token = TokenGenerator.newToken()
        val expiresAt = now.plus(14, ChronoUnit.DAYS)

        // (shareId, sendEmail) — email posíláme jen pokud je to úplně první sdílení
        // s tímto emailem od tohoto vlastníka. Při přidání dalšího účtu existujícímu
        // členovi (změna nastavení) se email už neopakuje.
        data class ShareResult(val shareId: UUID, val sendEmail: Boolean)
        val result = db {
            // Pokud existuje aktivní share pro stejnou kombinaci (email + účet) → idempotent.
            val existing = AccountShares.selectAll().where {
                (AccountShares.accountId eq accountId) and
                    (AccountShares.email.lowerCase() eq normalizedEmail) and
                    AccountShares.revokedAt.isNull()
            }.singleOrNull()

            if (existing != null) {
                ShareResult(existing[AccountShares.id].value, sendEmail = false)
            } else {
                // Má vlastník už jiný aktivní share pro tento email (jiný účet)?
                // Pak email znovu nezasíláme — člen už ví, kde Cointrack najde.
                val ownerAlreadyHasShareForEmail = AccountShares
                    .innerJoin(Accounts).innerJoin(Profiles)
                    .selectAll()
                    .where {
                        (AccountShares.email.lowerCase() eq normalizedEmail) and
                            (Profiles.ownerUserId eq ownerUserId) and
                            AccountShares.revokedAt.isNull()
                    }
                    .any()

                val newId = AccountShares.insertAndGetId {
                    it[AccountShares.accountId] = EntityID(accountId, Accounts)
                    it[AccountShares.email] = normalizedEmail
                    it[AccountShares.role] = req.role
                    it[AccountShares.visibilityIncome] = req.visibilityIncome
                    it[AccountShares.visibilityExpenses] = req.visibilityExpenses
                    it[AccountShares.visibilityCategories] = encodeCategoryFilter(req.visibilityCategories)
                    // Pokud již existuje aktivní share pro daný email, nový share je
                    // automaticky "accepted" (= aktivní hned), protože uživatel už dříve
                    // přijal pozvánku tímto emailem. Najdeme jeho userId.
                    val existingUser = AccountShares
                        .innerJoin(Accounts).innerJoin(Profiles)
                        .selectAll()
                        .where {
                            (AccountShares.email.lowerCase() eq normalizedEmail) and
                                (Profiles.ownerUserId eq ownerUserId) and
                                AccountShares.revokedAt.isNull() and
                                AccountShares.acceptedAt.isNotNull()
                        }
                        .firstOrNull()
                    if (existingUser != null) {
                        // Auto-accept: linkuj na stejného usera, který už přijal jiný share
                        existingUser[AccountShares.userId]?.let { uid ->
                            it[AccountShares.userId] = uid
                            it[AccountShares.acceptedAt] = now
                            // inviteToken zůstane pro případnou re-pozvánku, ale není potřeba
                        }
                        it[AccountShares.inviteToken] = null
                    } else {
                        it[AccountShares.inviteToken] = TokenGenerator.hash(token)
                    }
                    it[AccountShares.expiresAt] = expiresAt
                    it[AccountShares.inviterUserId] = EntityID(ownerUserId, Users)
                    it[AccountShares.createdAt] = now
                }.value
                ShareResult(newId, sendEmail = !ownerAlreadyHasShareForEmail)
            }
        }
        val shareId = result.shareId

        // Email pošleme jen u úplně nového člena (žádné jiné aktivní shares pro tento email).
        val acceptUrl = "$webBaseUrl/accept-share?token=$token"
        val recipientLocale = db {
            Users.selectAll().where { Users.email.lowerCase() eq normalizedEmail }
                .singleOrNull()?.get(Users.locale)
        }
        if (result.sendEmail) {
            try {
                email?.send(
                    to = normalizedEmail,
                    subject = EmailTemplates.accountShareInviteSubject(accountName, recipientLocale),
                    htmlBody = EmailTemplates.accountShareInvite(
                        accountName = accountName,
                        profileName = profileName,
                        inviterEmail = ownerEmail ?: "owner",
                        role = req.role,
                        acceptUrl = acceptUrl,
                        locale = recipientLocale,
                    ),
                )
            } catch (e: Exception) {
                log.warn("Failed to send account share invite to $normalizedEmail: ${e.message}")
            }
        } else {
            log.info("Account share added without email — owner $ownerUserId already has shares for $normalizedEmail")
        }
        log.info("Account share created: accountSync=$accountSyncId email=$normalizedEmail role=${req.role}")

        return getShare(shareId)!!
    }

    /**
     * Owner: list shares for account.
     * @param accountSyncId klient pošle syncId, mapujeme na DB id
     */
    suspend fun listForAccount(accountSyncId: UUID, ownerUserId: UUID): List<ShareDto> = db {
        // Verify ownership; klient posílá syncId
        val acc = Accounts.selectAll().where { Accounts.syncId eq accountSyncId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found",
                "Účet nenalezen (syncId=$accountSyncId).")
        val accountDbId = acc[Accounts.id].value
        val profileId = acc[Accounts.profileId].value
        val profile = Profiles.selectAll().where { Profiles.id eq profileId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
        if (profile[Profiles.ownerUserId].value != ownerUserId) {
            throw ApiException(HttpStatusCode.Forbidden, "not_owner", "Nejsi vlastníkem.")
        }

        AccountShares.selectAll()
            .where { (AccountShares.accountId eq accountDbId) and AccountShares.revokedAt.isNull() }
            .orderBy(AccountShares.createdAt, SortOrder.DESC)
            .map { row -> rowToDto(row) }
    }

    /**
     * Owner: změna existujícího sdílení (role + visibility filtry).
     *
     * Všechny parametry (role, visibilityIncome/Expenses/Categories) jsou volitelné —
     * `null` znamená neměnit. Pro reset visibilityCategories na "bez filtru" pošli
     * `resetVisibilityCategories = true`.
     */
    suspend fun updateShare(
        shareId: UUID,
        ownerUserId: UUID,
        update: UpdateShareRequest,
    ): ShareDto {
        update.role?.let {
            if (it !in setOf("VIEWER", "EDITOR", "ACCOUNTANT")) {
                throw ApiException(HttpStatusCode.BadRequest, "invalid_role",
                    "Role musí být VIEWER, EDITOR nebo ACCOUNTANT.")
            }
        }
        return db {
            val share = AccountShares.selectAll().where { AccountShares.id eq shareId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "share_not_found", "Sdílení nenalezeno.")
            if (share[AccountShares.revokedAt] != null) {
                throw ApiException(HttpStatusCode.Gone, "share_revoked", "Sdílení už bylo zrušeno.")
            }

            // Verify owner via account → profile
            val accountId = share[AccountShares.accountId].value
            val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found", "Účet nenalezen.")
            val profileId = acc[Accounts.profileId].value
            val profile = Profiles.selectAll().where { Profiles.id eq profileId }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
            if (profile[Profiles.ownerUserId].value != ownerUserId) {
                throw ApiException(HttpStatusCode.Forbidden, "not_owner", "Nejsi vlastníkem.")
            }

            AccountShares.update({ AccountShares.id eq shareId }) {
                update.role?.let { newRole -> it[role] = newRole }
                update.visibilityIncome?.let { v -> it[visibilityIncome] = v }
                update.visibilityExpenses?.let { v -> it[visibilityExpenses] = v }
                if (update.resetVisibilityCategories) {
                    it[visibilityCategories] = null
                } else {
                    update.visibilityCategories?.let { list ->
                        it[visibilityCategories] = encodeCategoryFilter(list)
                    }
                }
            }
            log.info("Account share updated: id=$shareId update=$update")
            getShare(shareId)!!
        }
    }

    /** Owner: revoke share. */
    suspend fun revoke(shareId: UUID, ownerUserId: UUID) = db {
        val share = AccountShares.selectAll().where { AccountShares.id eq shareId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "share_not_found", "Sdílení nenalezeno.")
        if (share[AccountShares.revokedAt] != null) return@db

        // Verify owner via account → profile
        val accountId = share[AccountShares.accountId].value
        val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "account_not_found", "Účet nenalezen.")
        val profileId = acc[Accounts.profileId].value
        val profile = Profiles.selectAll().where { Profiles.id eq profileId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")
        if (profile[Profiles.ownerUserId].value != ownerUserId) {
            throw ApiException(HttpStatusCode.Forbidden, "not_owner", "Nejsi vlastníkem.")
        }

        AccountShares.update({ AccountShares.id eq shareId }) {
            it[revokedAt] = Instant.now()
            it[inviteToken] = null
        }
        Unit
    }

    /** Náhled pozvánky před acceptem (z odkazu v emailu). */
    suspend fun previewInvite(token: String): InvitePreview = db {
        val tokenHash = TokenGenerator.hash(token)
        val share = AccountShares.selectAll().where {
            AccountShares.inviteToken eq tokenHash
        }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "invite_not_found",
                "Pozvánka nenalezena nebo už byla použita.")

        val expires = share[AccountShares.expiresAt]
        if (expires != null && expires.isBefore(Instant.now())) {
            throw ApiException(HttpStatusCode.Gone, "invite_expired", "Pozvánka vypršela.")
        }

        val accountId = share[AccountShares.accountId].value
        val acc = Accounts.selectAll().where { Accounts.id eq accountId }.single()
        val profileId = acc[Accounts.profileId].value
        val profile = Profiles.selectAll().where { Profiles.id eq profileId }.single()
        val owner = share[AccountShares.inviterUserId]?.let {
            Users.selectAll().where { Users.id eq it }.singleOrNull()
        }

        InvitePreview(
            ownerEmail = owner?.get(Users.email) ?: "Unknown",
            accountName = acc[Accounts.name],
            profileName = profile[Profiles.name],
            role = share[AccountShares.role],
            expiresAt = expires?.toString(),
        )
    }

    /**
     * Přijetí pozvánky — link `user_id` na share row.
     * @param allowDifferentEmail true = přijmout pod jiným e-mailem než byl
     *   v pozvánce (user explicitně klikl "už mám účet pod jiným emailem").
     *   Token v URL je sám o sobě dostatečná autorizace; e-mail check byl jen
     *   UX hint pro uživatele s víc účty otevřenými.
     */
    suspend fun acceptInvite(token: String, userId: UUID, allowDifferentEmail: Boolean = false): ShareDto {
        val tokenHash = TokenGenerator.hash(token)
        return db {
            val share = AccountShares.selectAll().where {
                AccountShares.inviteToken eq tokenHash
            }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "invite_not_found",
                    "Pozvánka nenalezena nebo už byla použita.")

            val expires = share[AccountShares.expiresAt]
            if (expires != null && expires.isBefore(Instant.now())) {
                throw ApiException(HttpStatusCode.Gone, "invite_expired", "Pozvánka vypršela.")
            }

            // Default: e-mail recipient se musí shodovat se share.email.
            // Override: `allowDifferentEmail=true` (user explicit volba "mám účet pod jiným emailem")
            // — token sám je dostatečná autorizace.
            val acceptingUserEmail = Users.selectAll().where { Users.id eq userId }
                .singleOrNull()?.get(Users.email)?.lowercase()
                ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "User nenalezen.")
            val inviteEmail = share[AccountShares.email].lowercase()
            if (!allowDifferentEmail && acceptingUserEmail != inviteEmail) {
                throw ApiException(HttpStatusCode.Forbidden, "wrong_user",
                    "Pozvánka byla zaslaná na jiný email ($inviteEmail).")
            }

            AccountShares.update({ AccountShares.id eq share[AccountShares.id] }) {
                it[AccountShares.userId] = EntityID(userId, Users)
                it[acceptedAt] = Instant.now()
                it[inviteToken] = null
            }
            getShare(share[AccountShares.id].value)!!
        }
    }

    /**
     * Owner: list všech share, které jsem vystavil (napříč všemi mými účty).
     * Pro stránku "Členové" — vlastník vidí všechny pozvané přes všechny své účty.
     */
    suspend fun listOwnedShares(ownerUserId: UUID): List<ShareWithAccountDto> = db {
        // Najdi všechny accounts, jejichž profile mám
        val ownedAccountIds = (Accounts innerJoin Profiles).selectAll()
            .where {
                (Profiles.ownerUserId eq ownerUserId) and
                    Accounts.deletedAt.isNull() and
                    Profiles.deletedAt.isNull()
            }
            .map { it[Accounts.id].value }

        if (ownedAccountIds.isEmpty()) return@db emptyList()

        AccountShares.selectAll()
            .where {
                (AccountShares.accountId inList ownedAccountIds) and
                    AccountShares.revokedAt.isNull()
            }
            .orderBy(AccountShares.createdAt, SortOrder.DESC)
            .mapNotNull { share ->
                val accountId = share[AccountShares.accountId].value
                val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                    ?: return@mapNotNull null
                val profile = Profiles.selectAll().where { Profiles.id eq acc[Accounts.profileId] }.singleOrNull()
                    ?: return@mapNotNull null
                val displayName = share[AccountShares.userId]?.value?.let { uid ->
                    Users.selectAll().where { Users.id eq uid }.singleOrNull()?.get(Users.displayName)
                }
                val status = when {
                    share[AccountShares.revokedAt] != null -> "revoked"
                    share[AccountShares.acceptedAt] != null -> "active"
                    else -> "pending"
                }
                ShareWithAccountDto(
                    id = share[AccountShares.id].value.toString(),
                    accountId = accountId.toString(),
                    accountSyncId = acc[Accounts.syncId].toString(),
                    accountName = acc[Accounts.name],
                    accountCurrency = acc[Accounts.currency],
                    profileSyncId = profile[Profiles.syncId].toString(),
                    profileName = profile[Profiles.name],
                    email = share[AccountShares.email],
                    role = share[AccountShares.role],
                    status = status,
                    acceptedAt = share[AccountShares.acceptedAt]?.toString(),
                    createdAt = share[AccountShares.createdAt].toString(),
                    userDisplayName = displayName,
                    visibilityIncome = share[AccountShares.visibilityIncome],
                    visibilityExpenses = share[AccountShares.visibilityExpenses],
                    visibilityCategories = parseCategoryFilter(share[AccountShares.visibilityCategories]),
                )
            }
    }

    /**
     * Sync helper — vrátí seznam účtů sdílených s daným userem (accepted, not revoked).
     * Pro každý: account info + role + zda je EDITOR.
     */
    suspend fun activeSharesForUser(userId: UUID): List<AccountInfo> = db {
        AccountShares.selectAll()
            .where {
                (AccountShares.userId eq userId) and
                    AccountShares.acceptedAt.isNotNull() and
                    AccountShares.revokedAt.isNull()
            }
            .mapNotNull { share ->
                val accountId = share[AccountShares.accountId].value
                val acc = Accounts.selectAll().where { Accounts.id eq accountId }.singleOrNull()
                    ?: return@mapNotNull null
                if (acc[Accounts.deletedAt] != null) return@mapNotNull null

                val profile = Profiles.selectAll().where { Profiles.id eq acc[Accounts.profileId] }.singleOrNull()
                    ?: return@mapNotNull null
                if (profile[Profiles.deletedAt] != null) return@mapNotNull null

                AccountInfo(
                    accountId = accountId.toString(),
                    name = acc[Accounts.name],
                    currency = acc[Accounts.currency],
                    profileId = profile[Profiles.id].value.toString(),
                    profileName = profile[Profiles.name],
                )
            }
    }

    /** Pomocný getter. */
    private suspend fun getShare(id: UUID): ShareDto? = db {
        AccountShares.selectAll().where { AccountShares.id eq id }.singleOrNull()?.let { rowToDto(it) }
    }

    private fun rowToDto(row: org.jetbrains.exposed.sql.ResultRow): ShareDto {
        val userId = row[AccountShares.userId]?.value
        val displayName = userId?.let {
            Users.selectAll().where { Users.id eq it }.singleOrNull()?.get(Users.displayName)
        }
        val status = when {
            row[AccountShares.revokedAt] != null -> "revoked"
            row[AccountShares.acceptedAt] != null -> "active"
            else -> "pending"
        }
        return ShareDto(
            id = row[AccountShares.id].value.toString(),
            accountId = row[AccountShares.accountId].value.toString(),
            email = row[AccountShares.email],
            role = row[AccountShares.role],
            status = status,
            acceptedAt = row[AccountShares.acceptedAt]?.toString(),
            createdAt = row[AccountShares.createdAt].toString(),
            userDisplayName = displayName,
            visibilityIncome = row[AccountShares.visibilityIncome],
            visibilityExpenses = row[AccountShares.visibilityExpenses],
            visibilityCategories = parseCategoryFilter(row[AccountShares.visibilityCategories]),
        )
    }
}
