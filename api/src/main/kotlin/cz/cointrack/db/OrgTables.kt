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
