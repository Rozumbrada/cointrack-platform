package cz.cointrack.org

import cz.cointrack.auth.TokenGenerator
import cz.cointrack.db.OrganizationInvites
import cz.cointrack.db.OrganizationMembers
import cz.cointrack.db.Organizations
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.email.EmailService
import cz.cointrack.email.EmailTemplates
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.lowerCase
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

private val log = LoggerFactory.getLogger(OrgService::class.java)

class OrgService(
    private val email: EmailService,
    private val webBaseUrl: String,
    private val inviteTtlDays: Int = 14,
) {

    // ─── Organizations ─────────────────────────────────────────────

    /**
     * Vytvoří organizaci. Volající se automaticky stává ownerem.
     * TODO Sprint 8: billing gate — povolit jen pokud user má "organization" tier.
     */
    suspend fun createOrganization(ownerUserId: UUID, req: CreateOrganizationRequest): OrganizationDto {
        val name = req.name.trim()
        if (name.isBlank() || name.length > 256) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_name", "Neplatný název organizace.")
        }

        if (req.type !in setOf("B2B", "GROUP")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_type",
                "type musí být 'B2B' nebo 'GROUP'.")
        }

        val ownerId = ownerUserId
        val createdOrg = db {
            val now = Instant.now()
            val orgId = Organizations.insertAndGetId {
                it[Organizations.name] = name
                it[Organizations.ownerUserId] = ownerId
                it[Organizations.planTier] = "organization"
                it[Organizations.maxFreeMembers] = 5
                it[Organizations.type] = req.type
                it[Organizations.currency] = req.currency
                it[Organizations.createdAt] = now
                it[Organizations.updatedAt] = now
            }.value

            OrganizationMembers.insertAndGetId {
                it[OrganizationMembers.organizationId] = orgId
                it[OrganizationMembers.userId] = ownerId
                it[OrganizationMembers.role] = "owner"
                it[OrganizationMembers.joinedAt] = now
            }

            OrganizationDto(
                id = orgId.toString(),
                name = name,
                ownerUserId = ownerUserId.toString(),
                planTier = "organization",
                maxFreeMembers = 5,
                myRole = "owner",
                memberCount = 1,
                type = req.type,
                currency = req.currency,
                createdAt = now.toString(),
            )
        }

        // Odeslat pozvánky (best-effort, selhání jedné nerozbije ostatní)
        req.inviteEmails
            .map { it.trim().lowercase() }
            .filter { it.isNotBlank() }
            .distinct()
            .forEach { email ->
                runCatching {
                    createInvite(
                        orgId = UUID.fromString(createdOrg.id),
                        req = CreateInviteRequest(email = email, role = "member"),
                        callerUserId = ownerUserId,
                    )
                }.onFailure { e ->
                    log.warn("Failed to auto-invite $email to new org ${createdOrg.id}: ${e.message}")
                }
            }

        return createdOrg
    }

    /** Seznam všech orgů, v kterých je user členem. */
    suspend fun listMyOrganizations(userId: UUID): OrganizationListResponse {
        val orgs = db {
            val myMemberships = OrganizationMembers
                .selectAll()
                .where { OrganizationMembers.userId eq userId }
                .associate { it[OrganizationMembers.organizationId].value to it[OrganizationMembers.role] }

            if (myMemberships.isEmpty()) return@db emptyList()

            val orgRows = Organizations
                .selectAll()
                .where { (Organizations.id inList myMemberships.keys) and Organizations.deletedAt.isNull() }
                .toList()

            orgRows.map { row ->
                val orgId = row[Organizations.id].value
                val count = OrganizationMembers.selectAll()
                    .where { OrganizationMembers.organizationId eq orgId }
                    .count().toInt()
                OrganizationDto(
                    id = orgId.toString(),
                    name = row[Organizations.name],
                    ownerUserId = row[Organizations.ownerUserId].value.toString(),
                    planTier = row[Organizations.planTier],
                    maxFreeMembers = row[Organizations.maxFreeMembers],
                    myRole = myMemberships[orgId] ?: "member",
                    memberCount = count,
                    type = row[Organizations.type],
                    currency = row[Organizations.currency],
                    createdAt = row[Organizations.createdAt].toString(),
                )
            }
        }
        return OrganizationListResponse(orgs)
    }

    // ─── Members ───────────────────────────────────────────────────

    suspend fun listMembers(orgId: UUID, callerUserId: UUID): MembersListResponse {
        requireOrgMember(orgId, callerUserId)
        val members = db {
            (OrganizationMembers innerJoin Users)
                .selectAll()
                .where { OrganizationMembers.organizationId eq orgId }
                .orderBy(OrganizationMembers.joinedAt to SortOrder.ASC)
                .map { row ->
                    MemberDto(
                        userId = row[OrganizationMembers.userId].value.toString(),
                        email = row[Users.email],
                        displayName = row[Users.displayName],
                        role = row[OrganizationMembers.role],
                        joinedAt = row[OrganizationMembers.joinedAt].toString(),
                    )
                }
        }
        return MembersListResponse(members)
    }

    suspend fun updateMemberRole(
        orgId: UUID,
        targetUserId: UUID,
        newRole: String,
        callerUserId: UUID,
    ) {
        if (newRole !in setOf("admin", "member")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_role",
                "Role musí být 'admin' nebo 'member'. Ownera nelze měnit přes tento endpoint.")
        }
        requireOrgAdmin(orgId, callerUserId)

        db {
            val target = OrganizationMembers.selectAll()
                .where { (OrganizationMembers.organizationId eq orgId) and (OrganizationMembers.userId eq targetUserId) }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "member_not_found", "Člen nenalezen.")

            if (target[OrganizationMembers.role] == "owner") {
                throw ApiException(HttpStatusCode.Forbidden, "cannot_change_owner",
                    "Role ownera nelze měnit.")
            }

            OrganizationMembers.update({
                (OrganizationMembers.organizationId eq orgId) and
                        (OrganizationMembers.userId eq targetUserId)
            }) {
                it[role] = newRole
            }
        }
    }

    suspend fun removeMember(orgId: UUID, targetUserId: UUID, callerUserId: UUID) {
        // Self-removal (leave org) je povoleno pro kohokoli — jinak jen admini.
        val isSelfRemoval = targetUserId == callerUserId
        if (!isSelfRemoval) requireOrgAdmin(orgId, callerUserId)
        else requireOrgMember(orgId, callerUserId)

        db {
            val target = OrganizationMembers.selectAll()
                .where { (OrganizationMembers.organizationId eq orgId) and (OrganizationMembers.userId eq targetUserId) }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.NotFound, "member_not_found", "Člen nenalezen.")

            // Owner se může sám odebrat (opustit skupinu) — ale admin ho odebrat nemůže.
            if (target[OrganizationMembers.role] == "owner" && !isSelfRemoval) {
                throw ApiException(HttpStatusCode.Forbidden, "cannot_remove_owner",
                    "Ownera může odebrat jen on sám (opustit skupinu).")
            }

            OrganizationMembers.deleteWhere {
                with(it) {
                    (OrganizationMembers.organizationId eq orgId) and
                        (OrganizationMembers.userId eq targetUserId)
                }
            }
            Unit
        }
    }

    // ─── Invites ───────────────────────────────────────────────────

    /**
     * Vytvoří pozvánku, uloží hash tokenu, pokusí se poslat e-mail.
     * Vrací InviteDto (bez plaintext tokenu — ten odchází jen mailem).
     */
    suspend fun createInvite(
        orgId: UUID,
        req: CreateInviteRequest,
        callerUserId: UUID,
    ): InviteDto {
        val normalizedEmail = req.email.trim().lowercase()
        if (!emailRegex.matches(normalizedEmail) || normalizedEmail.length > 254) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_email", "Email není validní.")
        }
        if (req.role !in setOf("admin", "member")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_role",
                "Role musí být 'admin' nebo 'member'.")
        }
        requireOrgAdmin(orgId, callerUserId)

        val token = TokenGenerator.newToken()
        val tokenHash = TokenGenerator.hash(token)
        val now = Instant.now()
        val expiresAt = now.plusSeconds(inviteTtlDays * 86_400L)

        val (inviteDto, orgName, inviterEmail) = db {
            // Pokud už existuje otevřená pozvánka na stejný email → revokuj ji
            OrganizationInvites.update({
                (OrganizationInvites.organizationId eq orgId) and
                        (OrganizationInvites.email.lowerCase() eq normalizedEmail) and
                        (OrganizationInvites.acceptedAt.isNull()) and
                        (OrganizationInvites.revokedAt.isNull())
            }) {
                it[revokedAt] = now
            }

            // Pokud user s tím emailem už je členem → 409
            val userRow = Users.selectAll()
                .where { Users.email.lowerCase() eq normalizedEmail }
                .singleOrNull()
            if (userRow != null) {
                val existingMembership = OrganizationMembers.selectAll()
                    .where {
                        (OrganizationMembers.organizationId eq orgId) and
                                (OrganizationMembers.userId eq userRow[Users.id].value)
                    }.any()
                if (existingMembership) {
                    throw ApiException(HttpStatusCode.Conflict, "already_member",
                        "Tento uživatel již je členem organizace.")
                }
            }

            val inviteId = OrganizationInvites.insertAndGetId {
                it[organizationId] = orgId
                it[email] = normalizedEmail
                it[OrganizationInvites.tokenHash] = tokenHash
                it[role] = req.role
                it[invitedByUserId] = callerUserId
                it[OrganizationInvites.expiresAt] = expiresAt
                it[createdAt] = now
            }.value

            val org = Organizations.selectAll()
                .where { Organizations.id eq orgId }.single()
            val inviter = Users.selectAll()
                .where { Users.id eq callerUserId }.singleOrNull()

            Triple(
                InviteDto(
                    id = inviteId.toString(),
                    email = normalizedEmail,
                    role = req.role,
                    invitedByEmail = inviter?.get(Users.email),
                    expiresAt = expiresAt.toString(),
                    createdAt = now.toString(),
                ),
                org[Organizations.name],
                inviter?.get(Users.email),
            )
        }

        // Odeslání e-mailu — best-effort, selhání nerozbijí vytvoření pozvánky
        val acceptUrl = "$webBaseUrl/invite?token=$token"
        try {
            email.send(
                to = normalizedEmail,
                subject = "Pozvánka do organizace $orgName — Cointrack",
                htmlBody = EmailTemplates.organizationInvite(
                    organizationName = orgName,
                    inviterEmail = inviterEmail ?: "admin",
                    role = inviteDto.role,
                    acceptUrl = acceptUrl,
                ),
            )
        } catch (e: Exception) {
            log.warn("Failed to send org invite to $normalizedEmail: ${e.message}")
        }

        return inviteDto
    }

    suspend fun listInvites(orgId: UUID, callerUserId: UUID): InviteListResponse {
        requireOrgAdmin(orgId, callerUserId)

        val invites = db {
            OrganizationInvites.selectAll()
                .where {
                    (OrganizationInvites.organizationId eq orgId) and
                            (OrganizationInvites.acceptedAt.isNull()) and
                            (OrganizationInvites.revokedAt.isNull())
                }
                .orderBy(OrganizationInvites.createdAt to SortOrder.DESC)
                .map { row ->
                    val inviterEmail = Users.selectAll()
                        .where { Users.id eq row[OrganizationInvites.invitedByUserId].value }
                        .singleOrNull()?.get(Users.email)
                    InviteDto(
                        id = row[OrganizationInvites.id].value.toString(),
                        email = row[OrganizationInvites.email],
                        role = row[OrganizationInvites.role],
                        invitedByEmail = inviterEmail,
                        expiresAt = row[OrganizationInvites.expiresAt].toString(),
                        createdAt = row[OrganizationInvites.createdAt].toString(),
                    )
                }
        }
        return InviteListResponse(invites)
    }

    suspend fun revokeInvite(orgId: UUID, inviteId: UUID, callerUserId: UUID) {
        requireOrgAdmin(orgId, callerUserId)

        db {
            val affected = OrganizationInvites.update({
                (OrganizationInvites.id eq inviteId) and
                        (OrganizationInvites.organizationId eq orgId) and
                        (OrganizationInvites.acceptedAt.isNull()) and
                        (OrganizationInvites.revokedAt.isNull())
            }) {
                it[revokedAt] = Instant.now()
            }
            if (affected == 0) {
                throw ApiException(HttpStatusCode.NotFound, "invite_not_found",
                    "Pozvánka nenalezena nebo už byla přijata/zrušena.")
            }
        }
    }

    /**
     * Volající user přijímá pozvánku. Token musí platit, email pozvánky se
     * musí shodovat s emailem přihlášeného usera (nikdo jiný pozvánku nevyužije).
     */
    /** Sprint 5g.FIX.2 — veřejný preview pozvánky (bez auth). */
    suspend fun previewInvite(token: String): InvitePreviewResponse = db {
        val tokenHash = TokenGenerator.hash(token)
        val invite = OrganizationInvites.selectAll()
            .where { OrganizationInvites.tokenHash eq tokenHash }
            .singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "invalid_invite", "Pozvánka nenalezena.")

        val orgId = invite[OrganizationInvites.organizationId].value
        val org = Organizations.selectAll().where { Organizations.id eq orgId }.single()

        InvitePreviewResponse(
            email = invite[OrganizationInvites.email],
            role = invite[OrganizationInvites.role],
            organizationId = orgId.toString(),
            organizationName = org[Organizations.name],
            organizationType = org[Organizations.type],
            expired = invite[OrganizationInvites.expiresAt].isBefore(Instant.now()),
            accepted = invite[OrganizationInvites.acceptedAt] != null,
            revoked = invite[OrganizationInvites.revokedAt] != null,
        )
    }

    suspend fun acceptInvite(token: String, acceptingUserId: UUID): AcceptInviteResponse {
        val tokenHash = TokenGenerator.hash(token)
        val now = Instant.now()

        return db {
            val invite = OrganizationInvites.selectAll()
                .where { OrganizationInvites.tokenHash eq tokenHash }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_invite",
                    "Pozvánka neplatí nebo byla zrušena.")

            if (invite[OrganizationInvites.acceptedAt] != null) {
                throw ApiException(HttpStatusCode.BadRequest, "already_accepted",
                    "Pozvánka už byla přijata.")
            }
            if (invite[OrganizationInvites.revokedAt] != null) {
                throw ApiException(HttpStatusCode.BadRequest, "revoked_invite",
                    "Pozvánka byla zrušena.")
            }
            if (invite[OrganizationInvites.expiresAt].isBefore(now)) {
                throw ApiException(HttpStatusCode.BadRequest, "expired_invite",
                    "Pozvánka expirovala.")
            }

            val user = Users.selectAll()
                .where { Users.id eq acceptingUserId }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.Unauthorized, "user_not_found", "Uživatel nenalezen.")

            val inviteEmail = invite[OrganizationInvites.email].lowercase()
            if (user[Users.email].lowercase() != inviteEmail) {
                throw ApiException(HttpStatusCode.Forbidden, "wrong_account",
                    "Pozvánka je pro jiný e-mail. Přihlaš se k účtu s e-mailem $inviteEmail.")
            }

            val orgId = invite[OrganizationInvites.organizationId].value

            // Pokud už je členem — idempotence, jen označ pozvánku jako přijatou
            val alreadyMember = OrganizationMembers.selectAll()
                .where {
                    (OrganizationMembers.organizationId eq orgId) and
                            (OrganizationMembers.userId eq acceptingUserId)
                }.singleOrNull()

            if (alreadyMember == null) {
                OrganizationMembers.insertAndGetId {
                    it[organizationId] = orgId
                    it[userId] = acceptingUserId
                    it[role] = invite[OrganizationInvites.role]
                    it[joinedAt] = now
                }
            }

            OrganizationInvites.update({ OrganizationInvites.id eq invite[OrganizationInvites.id].value }) {
                it[acceptedAt] = now
            }

            val org = Organizations.selectAll()
                .where { Organizations.id eq orgId }.single()

            AcceptInviteResponse(
                organizationId = orgId.toString(),
                organizationName = org[Organizations.name],
                role = alreadyMember?.get(OrganizationMembers.role) ?: invite[OrganizationInvites.role],
            )
        }
    }

    // ─── Interní helpers ───────────────────────────────────────────

    /** Ověří že user je v orgu (jakákoli role). Jinak 403. */
    private suspend fun requireOrgMember(orgId: UUID, userId: UUID): ResultRow {
        return db {
            OrganizationMembers.selectAll()
                .where {
                    (OrganizationMembers.organizationId eq orgId) and
                            (OrganizationMembers.userId eq userId)
                }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.Forbidden, "not_member",
                    "Nemáš přístup k této organizaci.")
        }
    }

    /** Ověří že user je owner nebo admin. Jinak 403. */
    private suspend fun requireOrgAdmin(orgId: UUID, userId: UUID): ResultRow {
        val row = requireOrgMember(orgId, userId)
        val role = row[OrganizationMembers.role]
        if (role != "owner" && role != "admin") {
            throw ApiException(HttpStatusCode.Forbidden, "admin_required",
                "Tato akce vyžaduje roli admin nebo owner.")
        }
        return row
    }

    companion object {
        private val emailRegex = Regex("""^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$""")
    }
}
