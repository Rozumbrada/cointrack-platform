package cz.cointrack.org

import kotlinx.serialization.Serializable

// ─── Organizations ─────────────────────────────────────────────────

@Serializable
data class CreateOrganizationRequest(
    val name: String,
)

@Serializable
data class OrganizationDto(
    val id: String,
    val name: String,
    val ownerUserId: String,
    val planTier: String,
    val maxFreeMembers: Int,
    val myRole: String,          // role volajícího v této orgu
    val memberCount: Int,
    val createdAt: String,
)

@Serializable
data class OrganizationListResponse(
    val organizations: List<OrganizationDto>,
)

// ─── Members ───────────────────────────────────────────────────────

@Serializable
data class MemberDto(
    val userId: String,
    val email: String,
    val displayName: String? = null,
    val role: String,
    val joinedAt: String,
)

@Serializable
data class MembersListResponse(
    val members: List<MemberDto>,
)

@Serializable
data class UpdateMemberRoleRequest(
    val role: String,   // admin / member
)

// ─── Invites ───────────────────────────────────────────────────────

@Serializable
data class CreateInviteRequest(
    val email: String,
    val role: String = "member",   // admin / member
)

@Serializable
data class InviteDto(
    val id: String,
    val email: String,
    val role: String,
    val invitedByEmail: String?,
    val expiresAt: String,
    val createdAt: String,
)

@Serializable
data class InviteListResponse(
    val invites: List<InviteDto>,
)

@Serializable
data class AcceptInviteRequest(
    val token: String,
)

@Serializable
data class AcceptInviteResponse(
    val organizationId: String,
    val organizationName: String,
    val role: String,
)

@Serializable
data class MessageResponse(val message: String)
