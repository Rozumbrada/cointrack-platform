/**
 * Settings + throttling pro auto-sync (Fio + iDoklad při startu webu).
 *
 * localStorage keys:
 *   cointrack:autosync:enabled        - "1" / "0", default "1"
 *   cointrack:autosync:interval       - minuty (string), default "30"
 *   cointrack:autosync:last:{profile} - timestamp ms (string), per-profil
 *
 * Přepínač "auto-sync zapnuto" je globální (jeden user = jedno nastavení).
 * Throttling je per-profil — když uživatel přepne profil, sync se může
 * spustit znova hned (jiný profil = jiné Fio/iDoklad credentials).
 */

const KEY_ENABLED = "cointrack:autosync:enabled";
const KEY_INTERVAL = "cointrack:autosync:interval";
const KEY_LAST_PREFIX = "cointrack:autosync:last:";

const DEFAULT_INTERVAL_MINUTES = 30;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore (private mode / quota exceeded)
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isAutoSyncEnabled(): boolean {
  return safeGet(KEY_ENABLED) !== "0"; // default: zapnuto
}

export function setAutoSyncEnabled(enabled: boolean): void {
  safeSet(KEY_ENABLED, enabled ? "1" : "0");
}

export function getAutoSyncIntervalMinutes(): number {
  const raw = safeGet(KEY_INTERVAL);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MINUTES;
}

export function setAutoSyncIntervalMinutes(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  safeSet(KEY_INTERVAL, String(Math.floor(minutes)));
}

export function getLastAutoSyncAt(profileSyncId: string): number | null {
  const raw = safeGet(KEY_LAST_PREFIX + profileSyncId);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function markAutoSynced(profileSyncId: string): void {
  safeSet(KEY_LAST_PREFIX + profileSyncId, String(Date.now()));
}

/** Vyresetuje throttling pro daný profil — manuální sync má bypass. */
export function clearLastAutoSync(profileSyncId: string): void {
  safeRemove(KEY_LAST_PREFIX + profileSyncId);
}
