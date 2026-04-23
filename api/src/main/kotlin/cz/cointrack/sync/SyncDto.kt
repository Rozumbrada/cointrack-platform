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
