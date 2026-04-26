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
