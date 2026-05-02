/**
 * Helper pro lazy-create "Hotovost" účtu per profil.
 *
 * Sjednoceno s mobilem: cash účet je defaultně **zahrnutý do celkového
 * zůstatku** (mobile: `includeInTotal=true`). Reálný stav (i záporný) se
 * tak započítává do "Celkový zůstatek" — odpovídá tomu, kolik máš v hotovosti
 * v peněžence/pokladně. Před fixem web vytvářel cash účty s `excluded=true`,
 * takže webová suma neobsahovala hotovost a uživatel viděl jiné totály než
 * v mobilu.
 *
 * Mobile reference: `ReceiptRepository.kt:249` — Hotovost se počítá do
 * celkového zůstatku (může být i záporná).
 */

import { sync } from "./api";
import { withAuth } from "./auth-store";
import { ServerAccount } from "./sync-types";

const CASH_ACCOUNT_NAME = "Hotovost";
const CASH_ACCOUNT_TYPE = "cash";  // lowercase = mobile mapping (mapAccountType)

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
  // 1. Pull existující accounts a hledej JAKÝKOLI cash účet pro profil
  //    (předtím vyžadoval excluded=true → ignoroval user-vytvořené cash účty
  //    a vytvořil duplikát).
  const pull = await withAuth((t) => sync.pull(t));
  const accounts = (pull.entities["accounts"] ?? []).filter((e) => !e.deletedAt);

  const existing = accounts.find((e) => {
    const d = e.data as Record<string, unknown>;
    if (d.profileId !== profileSyncId) return false;
    const type = String(d.type ?? "").toLowerCase();
    return type === CASH_ACCOUNT_TYPE;
  });
  if (existing) return existing.syncId;

  // 2. Vytvoř nový Hotovost účet — INCLUDED v totalu (jak v mobilu).
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
    excludedFromTotal: false,  // ← FIX: cash MUSÍ být v totalu, jak v mobilu
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
