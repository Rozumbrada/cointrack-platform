package cz.cointrack.org

import kotlinx.serialization.Serializable

// ─── Organizations ─────────────────────────────────────────────────

@Serializable
data class CreateOrganizationRequest(
    val name: String,
    /** 'B2B' (default) nebo 'GROUP' (Sprint 5g). */
    val type: String = "B2B",
    val currency: String = "CZK",
    /** Volitelný seznam e-mailů na rozeslání pozvánek hned při vytvoření. */
    val inviteEmails: List<String> = emptyList(),
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
    val type: String = "B2B",
    val currency: String = "CZK",
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

/** Sprint 5g.FIX.2 — preview pozvánky bez auth (získat cílový email + org info). */
@Serializable
data class InvitePreviewResponse(
    val email: String,
    val role: String,
    val organizationId: String,
    val organizationName: String,
    val organizationType: String,     // 'B2B' | 'GROUP'
    val expired: Boolean,
    val accepted: Boolean,
    val revoked: Boolean,
)

@Serializable
data class AcceptInviteResponse(
    val organizationId: String,
    val organizationName: String,
    val role: String,
)

@Serializable
data class MessageResponse(val message: String)
