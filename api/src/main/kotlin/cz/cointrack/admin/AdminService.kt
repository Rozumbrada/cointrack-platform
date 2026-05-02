package cz.cointrack.admin

import cz.cointrack.db.Users
import cz.cointrack.db.db
import cz.cointrack.plugins.ApiException
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.Op
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.lowerCase
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import java.time.Instant
import java.util.UUID

/**
 * Admin sekce — management uživatelů. Přístup omezen přes `ADMIN_EMAILS` env
 * (čárkami oddělený seznam). Ostatní endpointy běžně zamítnou s 403.
 *
 * Funkčnosti:
 *   - List všech uživatelů s filtrováním
 *   - Update tier / displayName / emailVerified flag
 *   - Soft-delete uživatele (nastaví deletedAt; user se nemůže přihlásit, jeho
 *     data zůstanou v DB pro audit)
 */
class AdminService(
    /** Lowercase set adminských e-mailů z env `ADMIN_EMAILS`. Nemá kontextové DB ID, jen porovnání. */
    private val adminEmails: Set<String>,
) {

    fun isAdmin(email: String): Boolean = email.trim().lowercase() in adminEmails

    suspend fun isAdminUser(userId: UUID): Boolean = db {
        val email = Users.selectAll().where { Users.id eq userId }
            .singleOrNull()?.get(Users.email) ?: return@db false
        isAdmin(email)
    }

    suspend fun listUsers(query: String? = null, limit: Int = 100, offset: Int = 0): List<AdminUserDto> = db {
        val q = query?.trim()?.lowercase()
        val rows = if (q.isNullOrBlank()) {
            Users.selectAll()
                .orderBy(Users.createdAt, SortOrder.DESC)
                .limit(limit, offset.toLong())
                .toList()
        } else {
            Users.selectAll()
                .where {
                    (Users.email.lowerCase() like "%$q%") or
                        ((Users.displayName.lowerCase()) like "%$q%")
                }
                .orderBy(Users.createdAt, SortOrder.DESC)
                .limit(limit, offset.toLong())
                .toList()
        }
        rows.map { it.toAdminDto() }
    }

    suspend fun getUser(userId: UUID): AdminUserDto = db {
        Users.selectAll().where { Users.id eq userId }
            .singleOrNull()?.toAdminDto()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "Uživatel nenalezen.")
    }

    suspend fun updateUser(userId: UUID, req: UpdateUserRequest, callerEmail: String): AdminUserDto = db {
        val existing = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "Uživatel nenalezen.")

        // Bezpečnost: admin nemůže změnit svůj vlastní tier (chrání proti omylu
        // typu "downgrade nuluju a najednou ztratím admin práva"). Pokud je
        // potřeba, ať to udělá jiný admin.
        if (req.tier != null && existing[Users.email].equals(callerEmail, ignoreCase = true)) {
            throw ApiException(HttpStatusCode.BadRequest, "self_tier_change_forbidden",
                "Nemůžeš změnit svůj vlastní tier — požádej jiného admina.")
        }

        Users.update({ Users.id eq userId }) {
            req.tier?.let { t -> it[Users.tier] = t.uppercase() }
            req.displayName?.let { d -> it[Users.displayName] = d.takeIf { s -> s.isNotBlank() } }
            req.emailVerified?.let { v ->
                it[Users.emailVerifiedAt] = if (v) (existing[Users.emailVerifiedAt] ?: Instant.now()) else null
            }
            req.locale?.let { l -> it[Users.locale] = l }
            it[Users.updatedAt] = Instant.now()
        }
        Users.selectAll().where { Users.id eq userId }.single().toAdminDto()
    }

    suspend fun softDeleteUser(userId: UUID, callerEmail: String) = db {
        val existing = Users.selectAll().where { Users.id eq userId }.singleOrNull()
            ?: throw ApiException(HttpStatusCode.NotFound, "user_not_found", "Uživatel nenalezen.")
        if (existing[Users.email].equals(callerEmail, ignoreCase = true)) {
            throw ApiException(HttpStatusCode.BadRequest, "self_delete_forbidden",
                "Nemůžeš smazat svůj vlastní účet z admin rozhraní.")
        }
        Users.update({ Users.id eq userId }) {
            it[Users.deletedAt] = Instant.now()
            it[Users.updatedAt] = Instant.now()
        }
    }

    suspend fun restoreUser(userId: UUID) = db {
        Users.update({ Users.id eq userId }) {
            it[Users.deletedAt] = null
            it[Users.updatedAt] = Instant.now()
        }
    }

    private fun org.jetbrains.exposed.sql.ResultRow.toAdminDto(): AdminUserDto = AdminUserDto(
        id = this[Users.id].value.toString(),
        email = this[Users.email],
        displayName = this[Users.displayName],
        locale = this[Users.locale],
        tier = this[Users.tier],
        tierExpiresAt = this[Users.tierExpiresAt]?.toString(),
        emailVerified = this[Users.emailVerifiedAt] != null,
        createdAt = this[Users.createdAt].toString(),
        updatedAt = this[Users.updatedAt].toString(),
        deletedAt = this[Users.deletedAt]?.toString(),
    )
}

@Serializable
data class AdminUserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val locale: String,
    val tier: String,
    val tierExpiresAt: String? = null,
    val emailVerified: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String? = null,
)

@Serializable
data class UpdateUserRequest(
    val tier: String? = null,
    val displayName: String? = null,
    val emailVerified: Boolean? = null,
    val locale: String? = null,
)

