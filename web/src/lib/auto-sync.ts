/**
 * Auto-sync z webu — spustí Fio + iDoklad sync na backendu pro aktivní profil.
 *
 * Backend stáhne tx z bank/iDoklad a uloží do Postgres. Klient (web/mobile)
 * je dostane přes hlavní /sync flow (následný sync.pull v useSyncData hooks).
 *
 * Použití:
 *   - Auto: layout.tsx volá maybeRunAutoSync() při startu/profile change
 *   - Manual: <SyncButton /> v sidebaru volá runAllSyncs() bez throttlingu
 */

import { api } from "./api";
import { withAuth } from "./auth-store";

interface FioConnectionDto {
  id: string;
  name: string;
  accountIban?: string | null;
  lastSyncAt?: string | null;
  lastMovementId?: number | null;
}

interface FioConnectionsResponse {
  connections: FioConnectionDto[];
}

interface FioSyncResult {
  added: number;
  skipped: number;
  accountIban?: string | null;
  lastMovementId?: number | null;
}

interface IDokladStatus {
  configured: boolean;
  clientId?: string;
  lastSyncAt?: string;
  tokenExpiresAt?: string;
}

interface IDokladSyncResult {
  issuedAdded: number;
  issuedUpdated: number;
  receivedAdded: number;
  receivedUpdated: number;
  total: number;
}

/** Souhrnný výsledek auto-syncu — jeden řádek per service, vč. počtu chyb. */
export interface AutoSyncResult {
  /** Fio: per-connection výsledky + souhrn. */
  fio: {
    /** Počet úspěšně synchronizovaných connections. */
    succeeded: number;
    /** Počet connections, které selhaly (např. invalid token, Fio 500). */
    failed: number;
    /** Suma `added` přes všechny úspěšné connections. */
    totalAdded: number;
    /** Konkrétní jména connections + jejich added (pro detail v toastu). */
    perConnection: Array<{ name: string; added: number; error?: string }>;
  };
  idoklad: {
    /** True pokud iDoklad běžel (= konfigurován). */
    ran: boolean;
    /** True pokud sync úspěšně proběhl. */
    succeeded: boolean;
    /** Počet nově přidaných faktur (vystavené + přijaté). */
    totalAdded: number;
    error?: string;
  };
  /** True pokud aspoň jedna ze service vrátila aspoň jednu novou věc. */
  anythingNew: boolean;
}

/**
 * Spustí Fio sync všech connections + iDoklad sync (pokud konfigurováno) pro
 * daný profil. Sequential (Fio nejdřív, pak iDoklad), failure jedné nezablokuje
 * druhou. Vrací souhrn pro UI feedback.
 *
 * **NEvyhazuje** — aplikační chyby zachytí a zaznamená do `result.fio.failed`
 * nebo `result.idoklad.error`. Caller dostane plný kontext.
 */
export async function runAllSyncs(profileSyncId: string): Promise<AutoSyncResult> {
  const result: AutoSyncResult = {
    fio: { succeeded: 0, failed: 0, totalAdded: 0, perConnection: [] },
    idoklad: { ran: false, succeeded: false, totalAdded: 0 },
    anythingNew: false,
  };

  // ─── Fio: list connections → sync each ────────────────────────────────
  let connections: FioConnectionDto[] = [];
  try {
    const list = await withAuth((tk) =>
      api<FioConnectionsResponse>(
        `/api/v1/fio/profiles/${profileSyncId}/connections`,
        { token: tk },
      ),
    );
    connections = list.connections ?? [];
  } catch {
    // List Fio se nepovedl — třeba síťová chyba. Skip celá Fio sekce.
  }

  for (const c of connections) {
    try {
      const r = await withAuth((tk) =>
        api<FioSyncResult>(`/api/v1/fio/connections/${c.id}/sync`, {
          method: "POST",
          token: tk,
        }),
      );
      result.fio.succeeded += 1;
      result.fio.totalAdded += r.added ?? 0;
      result.fio.perConnection.push({ name: c.name, added: r.added ?? 0 });
    } catch (e) {
      result.fio.failed += 1;
      result.fio.perConnection.push({
        name: c.name,
        added: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ─── iDoklad: status check → sync (jen pokud konfigurováno) ───────────
  let idokladConfigured = false;
  try {
    const s = await withAuth((tk) =>
      api<IDokladStatus>(`/api/v1/idoklad/profiles/${profileSyncId}/status`, {
        token: tk,
      }),
    );
    idokladConfigured = !!s.configured;
  } catch {
    // ignore — pokud status selže, jen skip iDoklad sync
  }

  if (idokladConfigured) {
    result.idoklad.ran = true;
    try {
      const r = await withAuth((tk) =>
        api<IDokladSyncResult>(`/api/v1/idoklad/profiles/${profileSyncId}/sync`, {
          method: "POST",
          token: tk,
        }),
      );
      result.idoklad.succeeded = true;
      result.idoklad.totalAdded = (r.issuedAdded ?? 0) + (r.receivedAdded ?? 0);
    } catch (e) {
      result.idoklad.error = e instanceof Error ? e.message : String(e);
    }
  }

  result.anythingNew = result.fio.totalAdded > 0 || result.idoklad.totalAdded > 0;
  return result;
}

/**
 * Spustí auto-sync, pokud splňuje throttling (uživatel ho ještě dnes nespustil
 * nebo uplynul interval). Pro manuální trigger volej {@link runAllSyncs} přímo.
 *
 * @returns Výsledek pokud sync proběhl, jinak `null` (skipped throttling/disabled).
 */
export async function maybeRunAutoSync(
  profileSyncId: string,
): Promise<AutoSyncResult | null> {
  const { isAutoSyncEnabled, getLastAutoSyncAt, getAutoSyncIntervalMinutes, markAutoSynced } =
    await import("./auto-sync-settings");

  if (!isAutoSyncEnabled()) return null;

  const lastAt = getLastAutoSyncAt(profileSyncId);
  const intervalMs = getAutoSyncIntervalMinutes() * 60 * 1000;
  if (lastAt && Date.now() - lastAt < intervalMs) return null;

  // Mark BEFORE sync — i kdyby spadl, neretrigujeme za 5 sec
  markAutoSynced(profileSyncId);

  return await runAllSyncs(profileSyncId);
}
