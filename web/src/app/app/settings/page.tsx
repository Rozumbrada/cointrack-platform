"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, gdpr, DeletionStatusDto, UserDto } from "@/lib/api";
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
  const [deletion, setDeletion] = useState<DeletionStatusDto | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
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
    gdpr.deletionStatus(token).then(setDeletion).catch(() => {});
  }, []);

  async function onExportData() {
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(gdpr.exportDownloadUrl(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cointrack-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export selhal: ${e}`);
    }
  }

  async function onRequestDeletion() {
    const token = getAccessToken();
    if (!token) return;
    if (!confirm(
      "Opravdu chceš smazat účet?\n\n" +
      "• Účet bude označen ke smazání\n" +
      "• Po 30 dnech budou všechna data nenávratně smazána\n" +
      "• V této době se můžeš znovu přihlásit a smazání zrušit\n" +
      "• Hned budeš odhlášen ze všech zařízení",
    )) return;
    setDeletionBusy(true);
    try {
      const res = await gdpr.requestDeletion(token);
      setDeletion(res);
      // Po smazání se musíš odhlásit — backend zneplatnil sessions
      setTimeout(() => onLogout(), 2000);
    } catch (e) {
      setError(`Smazání selhalo: ${e}`);
    } finally {
      setDeletionBusy(false);
    }
  }

  async function onCancelDeletion() {
    const token = getAccessToken();
    if (!token) return;
    setDeletionBusy(true);
    try {
      await gdpr.cancelDeletion(token);
      const fresh = await gdpr.deletionStatus(token);
      setDeletion(fresh);
    } catch (e) {
      setError(`Zrušení selhalo: ${e}`);
    } finally {
      setDeletionBusy(false);
    }
  }

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

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">Tvá data (GDPR)</h2>
        <p className="text-sm text-ink-600 mb-4">
          Na základě GDPR (čl. 20) máš právo stáhnout si všechna svá data ve strojově čitelném formátu (JSON).
          Soubor obsahuje profily, účty, transakce, účtenky, faktury, věrnostní karty atd.
        </p>
        <button
          onClick={onExportData}
          className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
        >
          📥 Stáhnout moje data (JSON)
        </button>
      </section>

      {deletion?.requestedAt ? (
        <section className="bg-amber-50 rounded-2xl border border-amber-300 p-6">
          <h2 className="font-semibold text-amber-900 mb-2">⚠️ Účet je označen ke smazání</h2>
          <p className="text-sm text-amber-900 mb-4">
            Smazání bylo zažádáno {new Date(deletion.requestedAt).toLocaleString("cs-CZ")}.
            Data budou nenávratně smazána <b>{deletion.deleteAfterAt && new Date(deletion.deleteAfterAt).toLocaleDateString("cs-CZ")}</b>.
            Pokud sis to rozmyslel, můžeš smazání zrušit:
          </p>
          {deletion.canCancel && (
            <button
              onClick={onCancelDeletion}
              disabled={deletionBusy}
              className="h-10 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 text-white text-sm font-medium"
            >
              Zrušit smazání účtu
            </button>
          )}
        </section>
      ) : (
        <section className="bg-white rounded-2xl border border-red-200 p-6">
          <h2 className="font-semibold text-red-800 mb-2">Smazat účet</h2>
          <p className="text-sm text-ink-600 mb-4">
            Na základě GDPR (čl. 17) máš právo na úplné smazání svých dat. Účet bude označen
            a po 30denní lhůtě budou data <b>nenávratně smazána</b>. V této lhůtě je možné
            smazání ještě zrušit (přihlášením se zpět).
          </p>
          <button
            onClick={onRequestDeletion}
            disabled={deletionBusy}
            className="h-10 px-4 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-sm font-medium text-red-800 disabled:opacity-50"
          >
            🗑️ Smazat můj účet
          </button>
        </section>
      )}

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
