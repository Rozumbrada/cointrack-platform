package cz.cointrack.auth

import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String? = null,
    val locale: String? = null,
)

@Serializable
data class UpdateMeRequest(
    val locale: String? = null,
    val displayName: String? = null,
)

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val deviceId: String? = null,
)

@Serializable
data class RefreshRequest(
    val refreshToken: String,
)

@Serializable
data class ForgotPasswordRequest(
    val email: String,
)

@Serializable
data class ResetPasswordRequest(
    val token: String,
    val newPassword: String,
)

@Serializable
data class VerifyEmailRequest(
    val token: String,
)

@Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,   // sekundy
    val user: UserDto,
)

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val locale: String,
    val tier: String,
    val emailVerified: Boolean,
)

@Serializable
data class MessageResponse(
    val message: String,
)

@Serializable
data class MagicLinkRequest(
    val nextPath: String? = null,
)

@Serializable
data class MagicLinkResponse(
    val url: String,
)

@Serializable
data class MagicExchangeRequest(
    val token: String,
)
