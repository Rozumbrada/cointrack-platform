package cz.cointrack.org

import cz.cointrack.db.OrganizationMembers
import cz.cointrack.db.Profiles
import cz.cointrack.db.ProfilePermissions
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import java.time.Instant
import java.util.UUID

/**
 * Sprint 5f — správa per-profile permissions.
 *
 * Pravidla:
 *   - Pouze majitel profilu NEBO admin/owner organizace, ke které profil patří,
 *     může udělovat/odebírat oprávnění.
 *   - Permissions se vytváří jen pro profily, které patří do nějaké organizace
 *     (lokální/osobní profily nemají smysl sdílet mimo vlastníka).
 */
class PermissionService {

    suspend fun listPermissions(profileSyncId: UUID, callerUserId: UUID): ProfilePermissionsResponse = db {
        val profile = requireCanManagePermissions(profileSyncId, callerUserId)
        val profileDbId = profile[Profiles.id].value

        val rows = (ProfilePermissions innerJoin Users)
            .selectAll()
            .where { ProfilePermissions.profileId eq profileDbId }
            .orderBy(ProfilePermissions.grantedAt to SortOrder.DESC)
            .map { row ->
                ProfilePermissionDto(
                    userId = row[ProfilePermissions.userId].value.toString(),
                    email = row[Users.email],
                    displayName = row[Users.displayName],
                    permission = row[ProfilePermissions.permission],
                    grantedAt = row[ProfilePermissions.grantedAt].toString(),
                )
            }

        ProfilePermissionsResponse(profileId = profileSyncId.toString(), permissions = rows)
    }

    suspend fun grantPermission(
        profileSyncId: UUID,
        targetUserId: UUID,
        permission: String,
        callerUserId: UUID,
    ): ProfilePermissionDto {
        if (permission !in setOf("view", "edit")) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_permission",
                "Oprávnění musí být 'view' nebo 'edit'.")
        }

        return db {
            val profile = requireCanManagePermissions(profileSyncId, callerUserId)
            val profileDbId = profile[Profiles.id].value

            // Cil musi byt member same organizace jako profil
            val orgId = profile[Profiles.organizationId]?.value
                ?: throw ApiException(HttpStatusCode.BadRequest, "profile_not_in_org",
                    "Permissions lze nastavit jen pro profily přiřazené k organizaci.")

            val targetMembership = OrganizationMembers.selectAll()
                .where {
                    (OrganizationMembers.organizationId eq orgId) and
                        (OrganizationMembers.userId eq targetUserId)
                }.singleOrNull()
                ?: throw ApiException(HttpStatusCode.BadRequest, "not_org_member",
                    "Uživatel není členem organizace.")

            val targetRole = targetMembership[OrganizationMembers.role]
            if (targetRole == "owner" || targetRole == "admin") {
                throw ApiException(HttpStatusCode.BadRequest, "admin_has_access",
                    "Admin/owner má plný přístup ke všem profilům, oprávnění není potřeba.")
            }

            val now = Instant.now()
            val existing = ProfilePermissions.selectAll()
                .where {
                    (ProfilePermissions.profileId eq profileDbId) and
                        (ProfilePermissions.userId eq targetUserId)
                }.singleOrNull()

            if (existing != null) {
                ProfilePermissions.update({
                    (ProfilePermissions.profileId eq profileDbId) and
                        (ProfilePermissions.userId eq targetUserId)
                }) {
                    it[ProfilePermissions.permission] = permission
                    it[grantedByUserId] = callerUserId
                    it[grantedAt] = now
                }
            } else {
                ProfilePermissions.insertAndGetId {
                    it[ProfilePermissions.profileId] = profileDbId
                    it[ProfilePermissions.userId] = targetUserId
                    it[ProfilePermissions.permission] = permission
                    it[grantedByUserId] = callerUserId
                    it[grantedAt] = now
                }
            }

            val user = Users.selectAll().where { Users.id eq targetUserId }.single()
            ProfilePermissionDto(
                userId = targetUserId.toString(),
                email = user[Users.email],
                displayName = user[Users.displayName],
                permission = permission,
                grantedAt = now.toString(),
            )
        }
    }

    suspend fun revokePermission(profileSyncId: UUID, targetUserId: UUID, callerUserId: UUID) {
        db {
            val profile = requireCanManagePermissions(profileSyncId, callerUserId)
            val profileDbId = profile[Profiles.id].value
            val affected = ProfilePermissions.deleteWhere {
                with(it) {
                    (ProfilePermissions.profileId eq profileDbId) and
                        (ProfilePermissions.userId eq targetUserId)
                }
            }
            if (affected == 0) {
                throw ApiException(HttpStatusCode.NotFound, "permission_not_found",
                    "Oprávnění nenalezeno.")
            }
        }
    }

    /**
     * Zkontroluje, že caller má právo spravovat permissions k profilu.
     * Vrací ResultRow profilu, aby volající mohl použít (např. pro orgId).
     */
    private fun org.jetbrains.exposed.sql.Transaction.requireCanManagePermissions(
        profileSyncId: UUID,
        callerUserId: UUID,
    ): ResultRow {
        val profile = Profiles.selectAll().where { Profiles.syncId eq profileSyncId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "profile_not_found", "Profil nenalezen.")

        // 1) Majitel profilu
        if (profile[Profiles.ownerUserId].value == callerUserId) return profile

        // 2) Admin/owner organizace, ke které profil patří
        val orgId = profile[Profiles.organizationId]?.value
        if (orgId != null) {
            val membership = OrganizationMembers.selectAll()
                .where {
                    (OrganizationMembers.organizationId eq orgId) and
                        (OrganizationMembers.userId eq callerUserId)
                }.singleOrNull()
            val role = membership?.get(OrganizationMembers.role)
            if (role == "owner" || role == "admin") return profile
        }

        throw ApiException(HttpStatusCode.Forbidden, "cannot_manage_permissions",
            "Nemáš oprávnění spravovat přístupy k tomuto profilu.")
    }
}
