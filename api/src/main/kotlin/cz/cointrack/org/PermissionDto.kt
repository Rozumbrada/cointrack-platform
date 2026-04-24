package cz.cointrack.org

import kotlinx.serialization.Serializable

@Serializable
data class ProfilePermissionDto(
    val userId: String,
    val email: String,
    val displayName: String? = null,
    val permission: String,             // 'view' / 'edit'
    val grantedAt: String,
)

@Serializable
data class ProfilePermissionsResponse(
    val profileId: String,
    val permissions: List<ProfilePermissionDto>,
)

@Serializable
data class GrantPermissionRequest(
    val userId: String,
    val permission: String,             // 'view' / 'edit'
)
