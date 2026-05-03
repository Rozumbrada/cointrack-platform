package cz.cointrack.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Generický sync protokol.
 *
 * Klient posílá svoje lokální změny v `POST /api/v1/sync` a volá `GET /api/v1/sync?since=...`
 * pro stažení změn od jiných zařízení.
 *
 * Každá entita je serializována do `JsonObject` — sync vrstva nezná detail konkrétní entity,
 * jen sleduje `syncId`, `updatedAt`, `deletedAt`, `clientVersion`.
 */

@Serializable
data class SyncEntity(
    val syncId: String,           // UUID
    val updatedAt: String,        // ISO-8601 timestamp
    val deletedAt: String? = null,
    val clientVersion: Long,
    val data: JsonObject,         // konkrétní fields entity
)

@Serializable
data class SyncPullResponse(
    val serverTime: String,
    val entities: Map<String, List<SyncEntity>>,   // "profiles" -> [...], "accounts" -> [...], ...
    /**
     * Metadata o přístupových úrovních pro frontend.
     *
     * Frontend potřebuje vědět, na kterých profilech má user JEN per-account
     * sdílení (aby na dashboardu omezil viditelné účty), na kterých je vlastník/
     * accountant (= vidí vše) a které konkrétní účty má sdílené (pro filtraci
     * souhrnů per profil). Bez tohoto by sdílený user, který má i org-level
     * přístup, viděl na dashboardu i ne-sdílené účty profilu.
     */
    val accessControl: AccessControl? = null,
)

@Serializable
data class AccessControl(
    /** Profile syncIds, kde user vlastní (= owner / B2B admin / GROUP member / per-profile permission). */
    val ownedProfileSyncIds: List<String> = emptyList(),
    /** Profile syncIds, kde user má roli ACCOUNTANT (vidí celý profil read-only). */
    val accountantProfileSyncIds: List<String> = emptyList(),
    /**
     * Profile syncIds, kde user má JEN per-account sharing (VIEWER/EDITOR).
     * Na dashboardu tohoto profilu by se měly zobrazit POUZE účty z [sharedAccountSyncIds].
     */
    val sharedOnlyProfileSyncIds: List<String> = emptyList(),
    /** Konkrétní account syncIds, které user má přes per-account share (VIEWER/EDITOR). */
    val sharedAccountSyncIds: List<String> = emptyList(),
)

@Serializable
data class SyncPushRequest(
    val entities: Map<String, List<SyncEntity>>,   // podobný tvar jako pull
)

@Serializable
data class SyncPushResponse(
    val accepted: Map<String, List<String>>,      // entity -> [syncId, syncId, ...]
    val conflicts: Map<String, List<SyncEntity>>, // pokud byl konflikt, vrátí server verzi
)
