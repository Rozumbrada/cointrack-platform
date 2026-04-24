/**
 * Profile context — web drží currentProfileId v localStorage.
 * Používá se pro filtrování entit napříč stránkami (accounts, transactions, ...).
 */

"use client";

const KEY = "cointrack_currentProfileId";

export interface ProfileData {
  name: string;
  icon?: string;
  color?: number;
  isBusiness?: boolean;
  isGroup?: boolean;
  organizationId?: string;
  ico?: string;
  dic?: string;
  isVatPayer?: boolean;
}

export interface Profile {
  id: number;           // lokální Room ID (posílá mobilní klient)
  syncId: string;
  data: ProfileData;
}

export function getCurrentProfileId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function setCurrentProfileId(id: number | null) {
  if (typeof window === "undefined") return;
  if (id == null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, String(id));
  window.dispatchEvent(new CustomEvent("cointrack:profile-changed"));
}
