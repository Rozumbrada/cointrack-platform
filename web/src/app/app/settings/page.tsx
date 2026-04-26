"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, UserDto } from "@/lib/api";
import { clearAuth, getAccessToken } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import {
  getDefaultAccountSyncId,
  setDefaultAccountSyncId,
} from "@/lib/profile-store";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profileSyncId, entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const nonCashAccounts = accounts.filter(
    (a) => !(a.data.type === "CASH" && a.data.excludedFromTotal),
  );
  const [defaultAccount, setDefaultAccount] = useState<string>("");
  useEffect(() => {
    if (profileSyncId) {
      setDefaultAccount(getDefaultAccountSyncId(profileSyncId) ?? "");
    }
  }, [profileSyncId]);

  function onChangeDefaultAccount(v: string) {
    if (!profileSyncId) return;
    setDefaultAccount(v);
    setDefaultAccountSyncId(profileSyncId, v || null);
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    auth.me(token).then(setUser).catch((e) => setError(String(e)));
  }, []);

  async function onLogout() {
    const refresh = typeof window !== "undefined" ? localStorage.getItem("refreshToken") : null;
    try {
      if (refresh) await auth.logout(refresh);
    } catch {}
    clearAuth();
    router.replace("/login");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Nastavení</h1>
        <p className="text-sm text-ink-600 mt-1">Tvůj účet a předplatné.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-4">Účet</h2>
        <dl className="space-y-3 text-sm">
          <Row label="Email" value={user?.email} />
          <Row label="Jméno" value={user?.displayName ?? "—"} />
          <Row label="Jazyk" value={user?.locale ?? "—"} />
          <Row
            label="Tier"
            value={
              <span className="inline-block text-[10px] uppercase tracking-wide bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded">
                {user?.tier ?? "free"}
              </span>
            }
          />
          <Row
            label="Ověřený email"
            value={user?.emailVerified ? "✓ ano" : "ne"}
          />
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">Doklady</h2>
        <p className="text-sm text-ink-600 mb-3">
          Výchozí účet pro naskenované a nahrané účtenky/faktury (kromě hotovostních
          — ty jdou vždy na účet Hotovost). Nastavení je uloženo lokálně v prohlížeči
          a platí jen pro aktuálně vybraný profil.
        </p>
        <select
          value={defaultAccount}
          onChange={(e) => onChangeDefaultAccount(e.target.value)}
          className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900"
        >
          <option value="">— bez defaultu (první účet v seznamu) —</option>
          {nonCashAccounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">Mobilní aplikace</h2>
        <p className="text-sm text-ink-600 mb-4">
          Stáhni si Android aplikaci pro plnou funkcionalitu (scan účtenek, faktury, OCR,
          věrnostní karty, Pohoda export).
        </p>
        <a
          href="/download/latest.apk"
          className="inline-block h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
        >
          Stáhnout APK
        </a>
      </section>

      <section className="bg-white rounded-2xl border border-red-200 p-6">
        <h2 className="font-semibold text-red-800 mb-2">Odhlášení</h2>
        <p className="text-sm text-ink-600 mb-4">
          Odhlásíš se z webu. Mobilní aplikace zůstane přihlášená.
        </p>
        <button
          onClick={onLogout}
          className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
        >
          Odhlásit se
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-600">{label}</dt>
      <dd className="font-medium text-ink-900 text-right">{value}</dd>
    </div>
  );
}
