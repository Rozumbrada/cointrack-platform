"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sync, SyncEntity } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import {
  getCurrentProfileSyncId,
  setCurrentProfileSyncId,
  getDefaultProfileSyncId,
  setDefaultProfileSyncId,
} from "@/lib/profile-store";

interface ProfileData {
  name: string;
  type?: string;            // "PERSONAL" | "BUSINESS" | "GROUP"
  color?: number;
  ico?: string;
  dic?: string;
  companyName?: string;
  defaultCurrency?: string;
  organizationId?: string;
  cointrackUserId?: string;
}

interface Profile {
  syncId: string;
  data: ProfileData;
}

export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [autoNavigated, setAutoNavigated] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await withAuth((t) => sync.pull(t));
      const list = filterActiveProfiles(res.entities["profiles"] ?? []);
      setProfiles(list);
      setDefaultId(getDefaultProfileSyncId());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-select po načtení: pokud je default → jdi rovnou na dashboard,
  // jinak pokud má jen 1 profil → použij ho.
  useEffect(() => {
    if (loading || autoNavigated || profiles.length === 0) return;
    const defaultProfile = defaultId
      ? profiles.find((p) => p.syncId === defaultId)
      : null;
    if (defaultProfile) {
      setCurrentProfileSyncId(defaultProfile.syncId);
      setAutoNavigated(true);
      router.push("/app/dashboard");
      return;
    }
    if (profiles.length === 1) {
      setCurrentProfileSyncId(profiles[0].syncId);
      setAutoNavigated(true);
      router.push("/app/dashboard");
    }
  }, [loading, profiles, defaultId, autoNavigated, router]);

  function selectProfile(syncId: string) {
    setCurrentProfileSyncId(syncId);
    router.push("/app/dashboard");
  }

  function toggleDefault(syncId: string) {
    if (defaultId === syncId) {
      setDefaultProfileSyncId(null);
      setDefaultId(null);
    } else {
      setDefaultProfileSyncId(syncId);
      setDefaultId(syncId);
    }
  }

  async function deleteProfile(p: Profile) {
    const ok = confirm(
      `Opravdu smazat profil "${p.data.name}"?\n\n` +
      `Smaže se profil a VŠECHNA data v něm:\n` +
      `• účty + transakce\n` +
      `• účtenky + faktury\n` +
      `• kategorie + rozpočty + plánované platby\n` +
      `• dluhy, cíle, věrnostní karty, záruky, nákupní seznamy\n\n` +
      `Tato akce je nevratná.`,
    );
    if (!ok) return;
    try {
      const now = new Date().toISOString();

      // 1. Stáhni všechny entity, které patří k profilu (musí mít data.profileId == p.syncId)
      const pull = await withAuth((t) => sync.pull(t));

      const cascadeKeys = [
        "accounts",
        "categories",
        "transactions",
        "receipts",
        "receipt_items",
        "invoices",
        "invoice_items",
        "loyalty_cards",
        "budgets",
        "planned_payments",
        "debts",
        "goals",
        "warranties",
        "shopping_lists",
        "shopping_items",
        "merchant_rules",
        "investment_positions",
        "fio_accounts",
        "group_members",
        "group_expenses",
        "group_expense_items",
      ];

      const entities: Record<string, Array<{
        syncId: string;
        updatedAt: string;
        deletedAt: string;
        clientVersion: number;
        data: Record<string, unknown>;
      }>> = {};

      for (const key of cascadeKeys) {
        const all = pull.entities[key] ?? [];
        const toDelete = all.filter((e) => {
          if (e.deletedAt) return false;
          const d = e.data as Record<string, unknown>;
          // Pro entity přímo pod profilem — má profileId
          if (d.profileId === p.syncId) return true;
          return false;
        });
        if (toDelete.length > 0) {
          entities[key] = toDelete.map((e) => ({
            syncId: e.syncId,
            updatedAt: now,
            deletedAt: now,
            clientVersion: 1,
            data: e.data,
          }));
        }
      }

      // 2. Profil sám na konci
      entities["profiles"] = [
        {
          syncId: p.syncId,
          updatedAt: now,
          deletedAt: now,
          clientVersion: 1,
          data: p.data as unknown as Record<string, unknown>,
        },
      ];

      // 3. Push všeho najednou
      await withAuth((t) => sync.push(t, { entities }));

      // 4. Reset client-side state
      if (getCurrentProfileSyncId() === p.syncId) setCurrentProfileSyncId(null);
      if (getDefaultProfileSyncId() === p.syncId) {
        setDefaultProfileSyncId(null);
        setDefaultId(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center min-h-[60vh] text-ink-500 text-sm">
        Načítám profily…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Profily</h1>
        <p className="text-sm text-ink-600 mt-1">
          Vyber profil, se kterým chceš pracovat. Hvězdička = výchozí profil
          (otevře se rovnou po přihlášení).
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {profiles.map((p) => (
            <ProfileCard
              key={p.syncId}
              profile={p}
              isDefault={defaultId === p.syncId}
              onSelect={() => selectProfile(p.syncId)}
              onToggleDefault={() => toggleDefault(p.syncId)}
              onDelete={() => deleteProfile(p)}
            />
          ))}
        </div>
      )}

      <Link
        href="/app/profiles/new"
        className="block w-full py-3 rounded-xl border-2 border-dashed border-ink-300 hover:border-brand-500 hover:bg-brand-50 text-center text-sm font-medium text-ink-700 transition-colors"
      >
        + Nový profil
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
      <div className="text-4xl mb-3">👤</div>
      <div className="font-medium text-ink-900">Ještě nemáš žádný profil</div>
      <p className="text-sm text-ink-600 mt-2">
        Vytvoř svůj první profil — osobní, firemní nebo skupinový.
      </p>
    </div>
  );
}

function ProfileCard({
  profile,
  isDefault,
  onSelect,
  onToggleDefault,
  onDelete,
}: {
  profile: Profile;
  isDefault: boolean;
  onSelect: () => void;
  onToggleDefault: () => void;
  onDelete: () => void;
}) {
  const { data, syncId } = profile;
  const initial = (data.name?.[0] ?? "?").toUpperCase();
  const bg = profileColor(data.color);

  return (
    <div className="group bg-white rounded-2xl border border-ink-200 hover:border-brand-300 hover:shadow-md transition-all p-5 flex items-start gap-4">
      <button
        onClick={onSelect}
        className="flex items-start gap-3 flex-1 text-left min-w-0"
      >
        <div
          className="w-12 h-12 rounded-xl grid place-items-center text-lg font-semibold shrink-0"
          style={{ backgroundColor: bg, color: "#fff" }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink-900 truncate flex items-center gap-2">
            {data.name}
            {isDefault && (
              <span title="Výchozí profil" className="text-amber-500">
                ★
              </span>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-ink-500 mt-0.5">
            {labelType(data.type)}
            {data.defaultCurrency && (
              <span className="ml-2">· {data.defaultCurrency}</span>
            )}
          </div>
          {data.companyName && (
            <div className="text-xs text-ink-600 mt-1 truncate">
              {data.companyName}
              {data.ico && <span className="text-ink-400"> · IČO {data.ico}</span>}
            </div>
          )}
        </div>
      </button>

      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onToggleDefault}
          className={`w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 ${
            isDefault ? "text-amber-500" : "text-ink-400"
          }`}
          title={isDefault ? "Zrušit výchozí" : "Nastavit jako výchozí"}
        >
          {isDefault ? "★" : "☆"}
        </button>
        <Link
          href={`/app/profiles/${syncId}/edit`}
          className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"
          title="Upravit"
          onClick={(e) => e.stopPropagation()}
        >
          ✎
        </Link>
        <button
          onClick={onDelete}
          className="w-8 h-8 grid place-items-center rounded-lg hover:bg-red-50 text-red-500"
          title="Smazat"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function filterActiveProfiles(entities: SyncEntity[]): Profile[] {
  return entities
    .filter((e) => {
      if (e.deletedAt) return false;
      const d = e.data as Record<string, unknown>;
      if (d.deletedAt != null && d.deletedAt !== 0) return false;
      return true;
    })
    .map((e) => ({ syncId: e.syncId, data: e.data as unknown as ProfileData }))
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

function labelType(t?: string): string {
  switch (t) {
    case "BUSINESS":
      return "firemní";
    case "GROUP":
      return "skupinový";
    case "PERSONAL":
      return "osobní";
    default:
      return t ?? "—";
  }
}

function profileColor(c?: number): string {
  if (!c) return "#64748b"; // ink-500 fallback
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
