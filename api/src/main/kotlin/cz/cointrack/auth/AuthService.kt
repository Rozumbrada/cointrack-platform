package cz.cointrack.auth

import cz.cointrack.db.EmailVerifications
import cz.cointrack.db.PasswordResets
import cz.cointrack.db.RefreshTokens
import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.email.EmailService
import cz.cointrack.email.EmailTemplates
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insertAndGetId
import org.jetbrains.exposed.sql.lowerCase
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

private val log = LoggerFactory.getLogger(AuthService::class.java)

class AuthService(
    private val jwt: JwtService,
    private val email: EmailService,
    private val webBaseUrl: String,
    private val refreshTtlDays: Int = 30,
    private val verifyTtlHours: Int = 24,
    private val resetTtlHours: Int = 1,
) {

    // ─── Registrace ─────────────────────────────────────────────────────

    suspend fun register(req: RegisterRequest): UserDto {
        val normalizedEmail = req.email.trim().lowercase()
        validateEmail(normalizedEmail)
        validatePassword(req.password)

        val pwdHash = PasswordHasher.hash(req.password)

        val userId = db {
            val exists = Users.selectAll()
                .where { Users.email.lowerCase() eq normalizedEmail }
                .any()
            if (exists) {
                throw ApiException(HttpStatusCode.Conflict, "email_taken", "Email je již zaregistrován.")
            }
            val now = Instant.now()
            Users.insertAndGetId {
                it[email] = normalizedEmail
                it[passwordHash] = pwdHash
                it[displayName] = req.displayName
                it[locale] = req.locale ?: "cs"
                it[tier] = "FREE"
                it[createdAt] = now
                it[updatedAt] = now
            }.value
        }

        sendVerifyEmail(userId, normalizedEmail)

        return UserDto(
            id = userId.toString(),
            email = normalizedEmail,
            displayName = req.displayName,
            locale = req.locale ?: "cs",
            tier = "FREE",
            emailVerified = false,
        )
    }

    // ─── Login ──────────────────────────────────────────────────────────

    suspend fun login(req: LoginRequest): AuthResponse {
        val normalizedEmail = req.email.trim().lowercase()
        val row = db {
            Users.selectAll()
                .where { (Users.email.lowerCase() eq normalizedEmail) and Users.deletedAt.isNull() }
                .singleOrNull()
        } ?: throw ApiException(HttpStatusCode.Unauthorized, "invalid_credentials", "Nesprávný email nebo heslo.")

        val pwdHash = row[Users.passwordHash]
            ?: throw ApiException(HttpStatusCode.Unauthorized, "oauth_only_account",
                "Tento účet byl vytvořen přes Google. Přihlaš se přes Google.")

        if (!PasswordHasher.verify(pwdHash, req.password)) {
            throw ApiException(HttpStatusCode.Unauthorized, "invalid_credentials", "Nesprávný email nebo heslo.")
        }

        // Aktivace účtu jen po potvrzení emailu — V15+ enforcement.
        if (row[Users.emailVerifiedAt] == null) {
            throw ApiException(HttpStatusCode.Forbidden, "email_not_verified",
                "Účet není aktivovaný — klikni na odkaz v ověřovacím emailu, který ti přišel po registraci.")
        }

        return issueTokens(row, req.deviceId)
    }

    // ─── Refresh ────────────────────────────────────────────────────────

    suspend fun refresh(refreshToken: String): AuthResponse {
        val tokenHash = TokenGenerator.hash(refreshToken)
        val (user, refreshId) = db {
            val rt = RefreshTokens.selectAll()
                .where { RefreshTokens.tokenHash eq tokenHash }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.Unauthorized, "invalid_refresh", "Refresh token neplatný.")

            if (rt[RefreshTokens.revokedAt] != null) {
                throw ApiException(HttpStatusCode.Unauthorized, "revoked_refresh", "Refresh token byl zneplatněn.")
            }
            if (rt[RefreshTokens.expiresAt].isBefore(Instant.now())) {
                throw ApiException(HttpStatusCode.Unauthorized, "expired_refresh", "Refresh token expiroval.")
            }

            val user = Users.selectAll()
                .where { Users.id eq rt[RefreshTokens.userId].value }
                .single()

            // Revokuj starý token (rotation)
            RefreshTokens.update({ RefreshTokens.id eq rt[RefreshTokens.id].value }) {
                it[revokedAt] = Instant.now()
            }

            user to rt[RefreshTokens.id].value
        }

        return issueTokens(user, deviceId = null, previousRefreshId = refreshId)
    }

    // ─── Logout ─────────────────────────────────────────────────────────

    suspend fun logout(refreshToken: String) {
        val tokenHash = TokenGenerator.hash(refreshToken)
        db {
            RefreshTokens.update({ RefreshTokens.tokenHash eq tokenHash }) {
                it[revokedAt] = Instant.now()
            }
        }
    }

    // ─── Me ─────────────────────────────────────────────────────────────

    suspend fun me(userId: UUID): UserDto {
        val row = db {
            Users.selectAll()
                .where { Users.id eq userId }
                .singleOrNull()
        } ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "Uživatel nenalezen.")

        return row.toUserDto()
    }

    // ─── Email verification ─────────────────────────────────────────────

    suspend fun verifyEmail(token: String) {
        val hash = TokenGenerator.hash(token)
        db {
            val ev = EmailVerifications.selectAll()
                .where { EmailVerifications.tokenHash eq hash }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_token", "Neplatný verifikační odkaz.")

            if (ev[EmailVerifications.usedAt] != null) {
                throw ApiException(HttpStatusCode.BadRequest, "already_used", "Odkaz už byl použit.")
            }
            if (ev[EmailVerifications.expiresAt].isBefore(Instant.now())) {
                throw ApiException(HttpStatusCode.BadRequest, "expired", "Odkaz expiroval. Požádej o nový.")
            }

            val now = Instant.now()
            Users.update({ Users.id eq ev[EmailVerifications.userId].value }) {
                it[emailVerifiedAt] = now
                it[updatedAt] = now
            }
            EmailVerifications.update({ EmailVerifications.id eq ev[EmailVerifications.id].value }) {
                it[usedAt] = now
            }
        }
    }

    // ─── Forgot / Reset password ────────────────────────────────────────

    suspend fun forgotPassword(emailAddr: String) {
        val normalizedEmail = emailAddr.trim().lowercase()
        val (userId, userEmail, userLocale) = db {
            val row = Users.selectAll()
                .where { (Users.email.lowerCase() eq normalizedEmail) and Users.deletedAt.isNull() }
                .singleOrNull()
            row?.let { Triple(it[Users.id].value, it[Users.email], it[Users.locale]) }
        } ?: return  // Záměrně neprozrazujeme, že email neexistuje

        val token = TokenGenerator.newToken()
        val now = Instant.now()
        db {
            PasswordResets.insertAndGetId {
                it[this.userId] = userId
                it[tokenHash] = TokenGenerator.hash(token)
                it[expiresAt] = now.plusSeconds(resetTtlHours * 3600L)
                it[createdAt] = now
            }
        }

        val resetUrl = "$webBaseUrl/reset?token=$token"
        // Email send je best-effort — endpoint vrací 200 i když SMTP selže
        // (už jen z principu "neprozrazovat jestli email existuje").
        try {
            email.send(
                userEmail,
                EmailTemplates.passwordResetSubject(userLocale),
                EmailTemplates.passwordReset(resetUrl, userLocale),
            )
        } catch (e: Exception) {
            log.warn("Failed to send password reset email to $userEmail: ${e.message}")
        }
    }

    suspend fun resetPassword(token: String, newPassword: String) {
        validatePassword(newPassword)
        val hash = TokenGenerator.hash(token)
        val newHash = PasswordHasher.hash(newPassword)

        db {
            val pr = PasswordResets.selectAll()
                .where { PasswordResets.tokenHash eq hash }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_token", "Neplatný odkaz.")

            if (pr[PasswordResets.usedAt] != null) {
                throw ApiException(HttpStatusCode.BadRequest, "already_used", "Odkaz už byl použit.")
            }
            if (pr[PasswordResets.expiresAt].isBefore(Instant.now())) {
                throw ApiException(HttpStatusCode.BadRequest, "expired", "Odkaz expiroval.")
            }

            val now = Instant.now()
            Users.update({ Users.id eq pr[PasswordResets.userId].value }) {
                it[passwordHash] = newHash
                it[updatedAt] = now
            }
            PasswordResets.update({ PasswordResets.id eq pr[PasswordResets.id].value }) {
                it[usedAt] = now
            }
            // Revokuj všechny existující refresh tokeny (přinuť re-login všude)
            RefreshTokens.update({ RefreshTokens.userId eq pr[PasswordResets.userId].value }) {
                it[revokedAt] = now
            }
        }
    }

    // ─── Magic link (deep-link auto-login z mobilu na web) ──────────────

    /**
     * Vytvoří jednorázový krátkodobý token (5 min, single-use), který může mobil
     * zabudovat do URL: `cointrack.cz/auth/magic?t=<token>&next=/app/upgrade`.
     * Web pak zavolá [exchangeMagic] a získá plnohodnotný JWT.
     */
    suspend fun createMagicLink(userId: UUID, nextPath: String?): String {
        val token = TokenGenerator.newToken()
        val now = Instant.now()
        db {
            cz.cointrack.db.MagicTokens.insertAndGetId {
                it[this.userId] = userId
                it[tokenHash] = TokenGenerator.hash(token)
                it[this.nextPath] = nextPath?.takeIf { p -> p.startsWith("/") }
                it[expiresAt] = now.plusSeconds(5 * 60L)
                it[createdAt] = now
            }
        }
        val safeNext = nextPath?.takeIf { it.startsWith("/") }?.let { "&next=$it" } ?: ""
        return "$webBaseUrl/auth/magic?t=$token$safeNext"
    }

    /** Vymění magic token za AuthResponse (JWT + refresh). Single-use. */
    suspend fun exchangeMagic(token: String): AuthResponse {
        val hash = TokenGenerator.hash(token)
        val userRow = db {
            val mt = cz.cointrack.db.MagicTokens.selectAll()
                .where { cz.cointrack.db.MagicTokens.tokenHash eq hash }
                .singleOrNull()
                ?: throw ApiException(HttpStatusCode.BadRequest, "invalid_magic", "Neplatný magic token.")
            if (mt[cz.cointrack.db.MagicTokens.usedAt] != null) {
                throw ApiException(HttpStatusCode.BadRequest, "already_used", "Magic token už byl použit.")
            }
            if (mt[cz.cointrack.db.MagicTokens.expiresAt].isBefore(Instant.now())) {
                throw ApiException(HttpStatusCode.BadRequest, "expired", "Magic token expiroval (5 min).")
            }
            cz.cointrack.db.MagicTokens.update({ cz.cointrack.db.MagicTokens.id eq mt[cz.cointrack.db.MagicTokens.id].value }) {
                it[usedAt] = Instant.now()
            }
            Users.selectAll().where { Users.id eq mt[cz.cointrack.db.MagicTokens.userId].value }.single()
        }
        return issueTokens(userRow, deviceId = null)
    }

    // ─── Interní ────────────────────────────────────────────────────────

    private suspend fun issueTokens(
        userRow: ResultRow,
        deviceId: String?,
        previousRefreshId: UUID? = null,
    ): AuthResponse {
        val userId = userRow[Users.id].value
        val accessToken = jwt.issueAccessToken(
            userId = userId,
            email = userRow[Users.email],
            tier = userRow[Users.tier],
        )
        val refreshToken = TokenGenerator.newToken()
        val refreshHash = TokenGenerator.hash(refreshToken)
        val now = Instant.now()

        db {
            RefreshTokens.insertAndGetId {
                it[this.userId] = userId
                it[tokenHash] = refreshHash
                it[this.deviceId] = deviceId
                it[expiresAt] = now.plusSeconds(refreshTtlDays * 86_400L)
                it[createdAt] = now
            }
        }

        return AuthResponse(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresIn = 15 * 60,
            user = userRow.toUserDto(),
        )
    }

    private suspend fun sendVerifyEmail(userId: UUID, toEmail: String) {
        val token = TokenGenerator.newToken()
        val now = Instant.now()
        val userLocale = db {
            EmailVerifications.insertAndGetId {
                it[this.userId] = userId
                it[tokenHash] = TokenGenerator.hash(token)
                it[expiresAt] = now.plusSeconds(verifyTtlHours * 3600L)
                it[createdAt] = now
            }
            Users.selectAll().where { Users.id eq userId }.singleOrNull()?.get(Users.locale)
        }
        val verifyUrl = "$webBaseUrl/verify?token=$token"
        try {
            email.send(
                toEmail,
                EmailTemplates.verifyEmailSubject(userLocale),
                EmailTemplates.verifyEmail(verifyUrl, userLocale),
            )
        } catch (e: Exception) {
            log.warn("Failed to send verification email to $toEmail (user still registered): ${e.message}")
        }
    }

    // ─── Validace ───────────────────────────────────────────────────────

    private val emailRegex = Regex("""^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$""")

    private fun validateEmail(value: String) {
        if (!emailRegex.matches(value) || value.length > 254) {
            throw ApiException(HttpStatusCode.BadRequest, "invalid_email", "Email není validní.")
        }
    }

    private fun validatePassword(value: String) {
        when {
            value.length < 8 ->
                throw ApiException(HttpStatusCode.BadRequest, "weak_password",
                    "Heslo musí mít aspoň 8 znaků.")
            value.length > 256 ->
                throw ApiException(HttpStatusCode.BadRequest, "weak_password",
                    "Heslo je příliš dlouhé.")
        }
    }
}

private fun ResultRow.toUserDto() = UserDto(
    id = this[Users.id].value.toString(),
    email = this[Users.email],
    displayName = this[Users.displayName],
    locale = this[Users.locale],
    tier = this[Users.tier],
    emailVerified = this[Users.emailVerifiedAt] != null,
)
