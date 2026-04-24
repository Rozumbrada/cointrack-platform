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
