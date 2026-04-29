"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api, sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

interface FioStatus {
  configured: boolean;
  lastSyncAt?: string;
  lastMovementId?: number;
  accountIban?: string;
}

interface FioSyncResult {
  added: number;
  skipped: number;
  accountIban?: string;
  lastMovementId?: number;
}

/**
 * Inline Fio Bank API token + sync card. Per-profil (každý profil má vlastní
 * token, server stahuje transakce a propaguje přes /sync na všechny klienty).
 *
 * Použití:
 *  - /app/banks (= "Bankovní spojení") — primární UI místo,
 *  - /app/fio (legacy) — kvůli backlinkům přesměrování na /app/banks#fio.
 *
 * Mirror mobile patternu: token nastavuje BankSyncScreen → FioAccountDialog,
 * v profile detailu už není.
 */
export function FioConnectionCard() {
  const t = useTranslations("fio_page");
  const [profileSyncId, setProfileSyncId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [status, setStatus] = useState<FioStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<FioSyncResult | null>(null);

  // Reaktivně načítáme aktivní profileSyncId, abychom přepnuli karty při
  // přepnutí profilu v sidebaru (event "cointrack:profile-changed").
  useEffect(() => {
    setProfileSyncId(getCurrentProfileSyncId());
    const onChange = () => setProfileSyncId(getCurrentProfileSyncId());
    window.addEventListener("cointrack:profile-changed", onChange);
    return () => window.removeEventListener("cointrack:profile-changed", onChange);
  }, []);

  useEffect(() => {
    if (!profileSyncId) return;
    (async () => {
      try {
        const res = await withAuth((tk) => sync.pull(tk));
        const entity = (res.entities["profiles"] ?? []).find(
          (e) => e.syncId === profileSyncId,
        );
        const name = (entity?.data as Record<string, unknown> | undefined)?.name;
        if (typeof name === "string") setProfileName(name);
      } catch {
        // ignore — fallback bez názvu
      }
    })();
  }, [profileSyncId]);

  async function loadStatus() {
    if (!profileSyncId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await withAuth((tk) =>
        api<FioStatus>(`/api/v1/fio/profiles/${profileSyncId}/status`, {
          token: tk,
        }),
      );
      setStatus(s);
      if (!s.configured) setEditing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSyncId]);

  async function saveToken() {
    if (!profileSyncId) return;
    if (!token.trim() || token.trim().length < 20) {
      setError(t("invalid_token"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await withAuth((tk) =>
        api<{ ok: boolean }>(`/api/v1/fio/credentials`, {
          method: "PUT",
          token: tk,
          body: { profileId: profileSyncId, token: token.trim() },
        }),
      );
      setToken("");
      setEditing(false);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearToken() {
    if (!profileSyncId) return;
    if (!confirm(t("disconnect_confirm"))) return;
    try {
      await withAuth((tk) =>
        api(`/api/v1/fio/profiles/${profileSyncId}/credentials`, {
          method: "DELETE",
          token: tk,
        }),
      );
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runSync() {
    if (!profileSyncId) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const r = await withAuth((tk) =>
        api<FioSyncResult>(`/api/v1/fio/profiles/${profileSyncId}/sync`, {
          method: "POST",
          token: tk,
        }),
      );
      setSyncResult(r);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  if (!profileSyncId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {t("no_profile")}
      </div>
    );
  }

  return (
    <div id="fio" className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
      <div className="p-5 border-b border-ink-100 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-amber-100 grid place-items-center text-amber-700 text-xl shrink-0">
          🟢
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink-900">{t("title")}</div>
          <div className="text-xs text-ink-600 mt-0.5">{t("subtitle")}</div>
          {profileName && (
            <div className="text-xs text-ink-500 mt-1">
              {t("for_profile")}: <span className="font-medium text-ink-700">{profileName}</span>
              <span className="ml-2 text-ink-400">— {t("per_profile_hint")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6 text-center text-ink-500 text-sm">{t("loading")}</div>
        ) : (
          <>
            {status?.configured && !editing && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-emerald-900">{t("connected")}</div>
                  {status.accountIban && (
                    <div className="text-xs text-emerald-800 mt-1 font-mono">
                      {t("iban")}: {status.accountIban}
                    </div>
                  )}
                  {status.lastSyncAt && (
                    <div className="text-xs text-emerald-700 mt-1">
                      {t("last_sync")}: {new Date(status.lastSyncAt).toLocaleString("cs-CZ")}
                    </div>
                  )}
                  {status.lastMovementId != null && (
                    <div className="text-xs text-emerald-700">
                      {t("last_movement")}: #{status.lastMovementId}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={runSync}
                    disabled={syncing}
                    className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {syncing ? t("syncing") : t("sync_btn")}
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    className="h-9 px-3 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-sm text-emerald-700"
                  >
                    {t("change")}
                  </button>
                  <button
                    onClick={clearToken}
                    className="h-9 px-3 rounded-lg text-sm text-red-600 hover:text-red-700"
                  >
                    {t("disconnect")}
                  </button>
                </div>
              </div>
            )}

            {syncResult && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                {t("sync_result", { added: syncResult.added, skipped: syncResult.skipped })}
              </div>
            )}

            {(editing || !status?.configured) && (
              <div className="space-y-3">
                <div className="font-medium text-ink-900 text-sm">
                  {status?.configured ? t("form_change_title") : t("form_connect_title")}
                </div>
                <div>
                  <p className="text-sm text-ink-600 mb-2">{t("form_intro")}</p>
                  <ol className="text-xs text-ink-600 space-y-1 list-decimal pl-5">
                    <li>{t("guide_step_1")}</li>
                    <li>{t("guide_step_2")}</li>
                    <li>{t("guide_step_3")}</li>
                  </ol>
                </div>
                <label className="block">
                  <div className="text-xs font-medium text-ink-700 mb-1">{t("token_label")}</div>
                  <div className="relative">
                    <input
                      type={tokenVisible ? "text" : "password"}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="aB12cD34eF…"
                      className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 pr-20 text-sm font-mono"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setTokenVisible((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-500 hover:text-ink-700 px-2"
                    >
                      {tokenVisible ? t("hide") : t("show")}
                    </button>
                  </div>
                  <p className="text-xs text-ink-500 mt-1">{t("token_hint")}</p>
                </label>
                <div className="flex gap-3">
                  {status?.configured && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setToken("");
                        setError(null);
                      }}
                      className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium"
                    >
                      {t("cancel")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={saveToken}
                    disabled={saving}
                    className="flex-1 h-10 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {saving ? t("saving") : t("save")}
                  </button>
                </div>
              </div>
            )}

            <div className="text-xs text-ink-500 pt-2 border-t border-ink-100">
              {t("after_sync_pre")}{" "}
              <Link href="/app/transactions" className="text-brand-600 hover:underline">
                {t("after_sync_link")}
              </Link>
              {t("after_sync_post")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
