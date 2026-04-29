/**
 * Profile context — web identifikuje profil přes syncId (UUID string),
 * protože backend serializuje profileId napříč entitami jako UUID.
 */

"use client";

const KEY = "cointrack_currentProfileSyncId";

export interface ProfileData {
  name: string;
  type?: string;
  icon?: string;
  color?: number;
  ico?: string;
  dic?: string;
  companyName?: string;
  organizationId?: string;
}

export interface Profile {
  syncId: string;        // primární klíč na webu
  data: ProfileData;
}

export function getCurrentProfileSyncId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setCurrentProfileSyncId(syncId: string | null) {
  if (typeof window === "undefined") return;
  if (syncId == null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, syncId);
  window.dispatchEvent(new CustomEvent("cointrack:profile-changed"));
}

// Zpětná kompatibilita se starším kódem co volal getCurrentProfileId()
export function getCurrentProfileId(): string | null {
  return getCurrentProfileSyncId();
}

export function setCurrentProfileId(syncId: string | null) {
  setCurrentProfileSyncId(syncId);
}

// ─── Profile type cache ─────────────────────────────────────────
// Cache jen pro UX — layout potřebuje znát typ aktivního profilu při prvním
// renderu (rozhodování o "Členové" v menu). Bez cache je activeProfileType=null
// dokud sync.pull nedoběhne, takže menu flickne / Členové se chvíli neukáže.
// Cache je per-syncId, naplňuje ji ProfileSwitcher (zná data z pull) a layout
// (po vlastním pullu).

const PROFILE_TYPE_CACHE_KEY = "cointrack_profileTypeBySyncId";

function readProfileTypeMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PROFILE_TYPE_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getCachedProfileType(syncId: string | null): string | null {
  if (!syncId) return null;
  return readProfileTypeMap()[syncId] ?? null;
}

export function setCachedProfileType(syncId: string, type: string | null) {
  if (typeof window === "undefined" || !syncId) return;
  const map = readProfileTypeMap();
  if (type == null) delete map[syncId];
  else map[syncId] = type;
  localStorage.setItem(PROFILE_TYPE_CACHE_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent("cointrack:profile-type-changed"));
}

// ─── Default profile (client-side preference) ──────────────────

const DEFAULT_KEY = "cointrack_defaultProfileSyncId";

export function getDefaultProfileSyncId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEFAULT_KEY);
}

export function setDefaultProfileSyncId(syncId: string | null) {
  if (typeof window === "undefined") return;
  if (syncId == null) localStorage.removeItem(DEFAULT_KEY);
  else localStorage.setItem(DEFAULT_KEY, syncId);
  window.dispatchEvent(new CustomEvent("cointrack:default-profile-changed"));
}

// ─── Default account per profil (pro auto-přiřazení účtenek/faktur) ──

const DEFAULT_ACCOUNT_KEY = "cointrack_defaultAccountByProfile";

interface DefaultAccountMap {
  [profileSyncId: string]: string;
}

function readDefaultAccountMap(): DefaultAccountMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(DEFAULT_ACCOUNT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getDefaultAccountSyncId(profileSyncId: string | null): string | null {
  if (!profileSyncId) return null;
  return readDefaultAccountMap()[profileSyncId] ?? null;
}

export function setDefaultAccountSyncId(profileSyncId: string, accountSyncId: string | null) {
  if (typeof window === "undefined") return;
  const map = readDefaultAccountMap();
  if (accountSyncId == null) delete map[profileSyncId];
  else map[profileSyncId] = accountSyncId;
  localStorage.setItem(DEFAULT_ACCOUNT_KEY, JSON.stringify(map));
}
