package cz.cointrack.access

import cz.cointrack.db.AccountShares
import cz.cointrack.db.Accounts
import cz.cointrack.db.OrganizationMembers
import cz.cointrack.db.Organizations
import cz.cointrack.db.ProfilePermissions
import cz.cointrack.db.Profiles
import org.jetbrains.exposed.sql.Transaction
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

/**
 * Sdílený model přístupu k profilu. Pravidla:
 *
 *  - **Owner** (`Profiles.ownerUserId == userId`)
 *  - **B2B org admin** (organizační role owner/admin)
 *  - **Skupinový profil** (kdokoli member v org typu GROUP)
 *  - **ProfilePermission** (záznam v `profile_permissions` s permission view nebo edit)
 *  - **ACCOUNTANT** (per-account share s role=ACCOUNTANT) — vidí celý profil read-only
 *
 * Dříve byly tyto funkce duplicitní v [SyncService] a [StorageRoutes]. Tento
 * soubor je sjednocuje pro nové callery (např. [ExportRoutes]). Při dalším
 * refactoringu sjednotit i existující kopie.
 */

/**
 * Profily, kde má user "plný" přístup (owner / org admin / group / per-profile perm).
 * **NE-zahrnuje ACCOUNTANT** — ten je řešený separátně v [accountantProfileIds].
 */
fun Transaction.fullAccessProfileIds(userId: UUID): List<UUID> {
    val adminOrgs = OrganizationMembers.selectAll()
        .where {
            (OrganizationMembers.userId eq userId) and
                (OrganizationMembers.role inList listOf("owner", "admin"))
        }
        .map { it[OrganizationMembers.organizationId].value }

    val allMemberOrgs = OrganizationMembers.selectAll()
        .where { OrganizationMembers.userId eq userId }
        .map { it[OrganizationMembers.organizationId].value }
    val groupOrgs = if (allMemberOrgs.isEmpty()) emptyList() else
        Organizations.selectAll()
            .where {
                (Organizations.id inList allMemberOrgs) and
                    (Organizations.type eq "GROUP") and
                    Organizations.deletedAt.isNull()
            }
            .map { it[Organizations.id].value }

    val accessibleOrgs = (adminOrgs + groupOrgs).distinct()

    val permProfiles = ProfilePermissions.selectAll()
        .where {
            (ProfilePermissions.userId eq userId) and
                (ProfilePermissions.permission inList listOf("view", "edit"))
        }
        .map { it[ProfilePermissions.profileId].value }

    return Profiles.selectAll()
        .where {
            var cond = (Profiles.ownerUserId eq userId)
            if (accessibleOrgs.isNotEmpty()) {
                cond = cond or (Profiles.organizationId inList accessibleOrgs)
            }
            if (permProfiles.isNotEmpty()) {
                cond = cond or (Profiles.id inList permProfiles)
            }
            cond and Profiles.deletedAt.isNull()
        }
        .map { it[Profiles.id].value }
}

/**
 * Profily, kde má user roli ACCOUNTANT (per-account share s role=ACCOUNTANT).
 * Účetní vidí celý profil read-only.
 */
fun Transaction.accountantProfileIds(userId: UUID): List<UUID> {
    val accountIds = AccountShares.selectAll()
        .where {
            (AccountShares.userId eq userId) and
                AccountShares.acceptedAt.isNotNull() and
                AccountShares.revokedAt.isNull() and
                (AccountShares.role eq "ACCOUNTANT")
        }
        .map { it[AccountShares.accountId].value }
    if (accountIds.isEmpty()) return emptyList()
    return Accounts.selectAll()
        .where { (Accounts.id inList accountIds) and Accounts.deletedAt.isNull() }
        .map { it[Accounts.profileId].value }
        .distinct()
}

/**
 * Vrátí všechny profily, kam user má read access (full + accountant).
 * Vhodné pro endpointy typu export, ke kterým by účetní měl přístup.
 *
 * Per-account VIEWER/EDITOR jsou ZÁMĚRNĚ vyloučeni — dostávají
 * jen řez profilu (sdílený účet), ne celý profil. Pokud potřebujeme
 * filtered export (jen sdílené účty), musíme implementovat zvlášť.
 */
fun Transaction.profilesUserCanRead(userId: UUID): Set<UUID> {
    return (fullAccessProfileIds(userId) + accountantProfileIds(userId)).toSet()
}
