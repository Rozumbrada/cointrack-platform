/**
 * Helper pro lazy-create "Hotovost" účtu per profil.
 *
 * Auto-vytvořený cash účet má `excludedFromTotal = true` (nepočítá se do
 * celkového zůstatku) a slouží jako default cíl pro hotovostní účtenky
 * a faktury. User ho v listu účtů uvidí jako standardní účet a může
 * sledovat, kolik utratil v hotovosti za období.
 */

import { sync } from "./api";
import { withAuth } from "./auth-store";
import { ServerAccount } from "./sync-types";

const CASH_ACCOUNT_NAME = "Hotovost";
const CASH_ACCOUNT_TYPE = "CASH";

/**
 * Vrátí syncId účtu Hotovost pro daný profil. Pokud neexistuje, vytvoří ho.
 *
 * @param profileSyncId  UUID profilu (string)
 * @param currency       měna nového účtu (default CZK)
 * @returns syncId existing nebo nově vytvořeného Hotovost účtu
 */
export async function ensureCashAccount(
  profileSyncId: string,
  currency: string = "CZK",
): Promise<string> {
  // 1. Pull existující accounts a hledej Hotovost pro profil
  const pull = await withAuth((t) => sync.pull(t));
  const accounts = (pull.entities["accounts"] ?? []).filter((e) => !e.deletedAt);

  const existing = accounts.find((e) => {
    const d = e.data as Record<string, unknown>;
    if (d.profileId !== profileSyncId) return false;
    const type = String(d.type ?? "").toUpperCase();
    const excluded = d.excludedFromTotal === true;
    return type === CASH_ACCOUNT_TYPE && excluded;
  });
  if (existing) return existing.syncId;

  // 2. Vytvoř nový Hotovost účet
  const newSyncId = crypto.randomUUID();
  const now = new Date().toISOString();
  const data: ServerAccount & Record<string, unknown> = {
    profileId: profileSyncId,
    name: CASH_ACCOUNT_NAME,
    type: CASH_ACCOUNT_TYPE,
    currency,
    initialBalance: "0.00",
    color: 0xfff59e0b, // amber
    icon: "payments",
    excludedFromTotal: true,
  };
  await withAuth((t) =>
    sync.push(t, {
      entities: {
        accounts: [
          {
            syncId: newSyncId,
            updatedAt: now,
            clientVersion: 1,
            data: data as unknown as Record<string, unknown>,
          },
        ],
      },
    }),
  );
  return newSyncId;
}
