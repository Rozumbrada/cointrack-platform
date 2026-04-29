"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api, sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

interface IDokladStatus {
  configured: boolean;
  clientId?: string;
  lastSyncAt?: string;
  tokenExpiresAt?: string;
}

interface SyncResult {
  issuedAdded: number;
  issuedUpdated: number;
  receivedAdded: number;
  receivedUpdated: number;
  total: number;
}

/**
 * /app/idoklad — pull faktury z iDoklad cloudu.
 *
 * Credentials editor (Client ID + Client Secret) byl přesunut do detailu
 * profilu (/app/profiles/[syncId]/edit, sekce "iDoklad") — sjednoceno
 * s mobile patternem (AddEditProfileScreen). Tahle stránka teď slouží
 * pouze jako sync runner + status panel + odkaz do nastavení credentials,
 * pokud nejsou ještě zadané.
 */
export default function IDokladPage() {
  const t = useTranslations("idoklad");
  const locale = useLocale();
  const profileSyncId = getCurrentProfileSyncId();
  const [profileName, setProfileName] = useState<string | null>(null);
  const [status, setStatus] = useState<IDokladStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Načteme jméno aktivního profilu pro hlavičku ("Pro profil: …")
  useEffect(() => {
    if (!profileSyncId) return;
    (async () => {
      try {
        const res = await withAuth((tk) => sync.pull(tk));
        const entity = (res.entities["profiles"] ?? []).find((e) => e.syncId === profileSyncId);
        const name = (entity?.data as Record<string, unknown> | undefined)?.name;
        if (typeof name === "string") setProfileName(name);
      } catch {
        // ignore
      }
    })();
  }, [profileSyncId]);

  async function loadStatus() {
    if (!profileSyncId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await withAuth((tk) =>
        api<IDokladStatus>(`/api/v1/idoklad/profiles/${profileSyncId}/status`, { token: tk }),
      );
      setStatus(s);
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

  async function runSync() {
    if (!profileSyncId) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const r = await withAuth((tk) =>
        api<SyncResult>(`/api/v1/idoklad/profiles/${profileSyncId}/sync`, {
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
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        {t("no_profile")}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">
          {t("subtitle_pre")}{" "}
          <a href="/app/invoices" className="text-brand-600 hover:underline">
            {t("subtitle_link")}
          </a>
          {t("subtitle_post")}
        </p>
        {profileName && (
          <p className="text-xs text-ink-500 mt-2">
            {t("for_profile")}: <span className="font-medium text-ink-700">{profileName}</span>
            <span className="ml-2 text-ink-400">— {t("per_profile_hint")}</span>
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : !status?.configured ? (
        // Credentials nejsou nastavené — uživatel je musí zadat v profilu
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
          <div className="font-medium text-amber-900">{t("not_configured_title")}</div>
          <p className="text-sm text-amber-800">{t("credentials_moved_to_profile")}</p>
          <Link
            href={`/app/profiles/${profileSyncId}/edit`}
            className="inline-flex h-9 px-4 items-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
          >
            {t("go_to_profile")}
          </Link>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium text-emerald-900">{t("connected")}</div>
              <div className="text-xs text-emerald-800 mt-1">
                {t("client_id_label")} <span className="font-mono">{status.clientId}</span>
              </div>
              {status.lastSyncAt && (
                <div className="text-xs text-emerald-800 mt-0.5">
                  {t("last_sync", {
                    date: new Date(status.lastSyncAt).toLocaleString(locale),
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href="/app/idoklad/new-invoice"
                className="h-10 px-4 inline-flex items-center rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium"
              >
                {t("new_invoice")}
              </a>
              <button
                onClick={runSync}
                disabled={syncing}
                className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {syncing ? t("syncing") : t("sync_btn")}
              </button>
              <Link
                href={`/app/profiles/${profileSyncId}/edit`}
                className="h-10 px-3 inline-flex items-center rounded-lg border border-emerald-300 text-emerald-800 text-sm hover:bg-emerald-100"
              >
                {t("manage_credentials")}
              </Link>
            </div>
          </div>
        </div>
      )}

      {syncResult && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 text-sm space-y-1">
          <div className="font-medium text-brand-900">
            {t("sync_done_total", { total: syncResult.total })}
          </div>
          <div className="text-brand-800">
            {t("sync_done_issued", {
              added: syncResult.issuedAdded,
              updated: syncResult.issuedUpdated,
            })}
          </div>
          <div className="text-brand-800">
            {t("sync_done_received", {
              added: syncResult.receivedAdded,
              updated: syncResult.receivedUpdated,
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-ink-200 p-6 text-sm text-ink-700 space-y-3">
        <div className="font-medium text-ink-900">{t("guide_title")}</div>
        <ol className="list-decimal list-inside space-y-1 text-ink-600">
          <li>
            {t("guide_step1_pre")}{" "}
            <a
              href="https://app.idoklad.cz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700"
            >
              {t("guide_step1_link")}
            </a>
          </li>
          <li>{t("guide_step2")}</li>
          <li>{t("guide_step3")}</li>
          <li>{t("guide_step4")}</li>
        </ol>
        <p className="text-xs text-ink-500 pt-2 border-t border-ink-100">{t("guide_security")}</p>
      </div>
    </div>
  );
}
