package cz.cointrack.db

import org.jetbrains.exposed.dao.id.UUIDTable
import org.jetbrains.exposed.sql.javatime.timestamp

/**
 * Sprint 5e — Organizations, members, invites.
 * Musí odpovídat V5.0__organizations.sql.
 */

object Organizations : UUIDTable("organizations") {
    val name            = varchar("name", 256)
    val ownerUserId     = reference("owner_user_id", Users)
    val planTier        = varchar("plan_tier", 32).default("organization")
    val maxFreeMembers  = integer("max_free_members").default(5)
    /** 'B2B' (Sprint 5e) nebo 'GROUP' (Sprint 5g). */
    val type            = varchar("type", 16).default("B2B")
    val currency        = varchar("currency", 3).default("CZK")
    val createdAt       = timestamp("created_at")
    val updatedAt       = timestamp("updated_at")
    val deletedAt       = timestamp("deleted_at").nullable()
}

object OrganizationMembers : UUIDTable("organization_members") {
    val organizationId  = reference("organization_id", Organizations)
    val userId          = reference("user_id", Users)
    val role            = varchar("role", 16).default("member")   // owner / admin / member
    val joinedAt        = timestamp("joined_at")

    init {
        uniqueIndex(organizationId, userId)
    }
}

object OrganizationInvites : UUIDTable("organization_invites") {
    val organizationId    = reference("organization_id", Organizations)
    val email             = varchar("email", 255)
    val tokenHash         = varchar("token_hash", 128).uniqueIndex()
    val role              = varchar("role", 16).default("member")
    val invitedByUserId   = reference("invited_by_user_id", Users)
    val expiresAt         = timestamp("expires_at")
    val acceptedAt        = timestamp("accepted_at").nullable()
    val revokedAt         = timestamp("revoked_at").nullable()
    val createdAt         = timestamp("created_at")
}

/** Sprint 5f — per-profile permissions pro memberi orgu. */
object ProfilePermissions : UUIDTable("profile_permissions") {
    val profileId         = reference("profile_id", Profiles)
    val userId            = reference("user_id", Users)
    val permission        = varchar("permission", 16)          // 'view' / 'edit'
    val grantedByUserId   = reference("granted_by_user_id", Users).nullable()
    val grantedAt         = timestamp("granted_at")

    init {
        uniqueIndex(profileId, userId)
    }
}
