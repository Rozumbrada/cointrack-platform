"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
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

export default function IDokladPage() {
  const t = useTranslations("idoklad");
  const locale = useLocale();
  const profileSyncId = getCurrentProfileSyncId();
  const [status, setStatus] = useState<IDokladStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  async function loadStatus() {
    if (!profileSyncId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await withAuth((tk) =>
        api<IDokladStatus>(
          `/api/v1/idoklad/profiles/${profileSyncId}/status`,
          { token: tk },
        ),
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

  async function saveCredentials() {
    if (!profileSyncId) return;
    if (!clientId.trim() || !clientSecret.trim()) {
      setError(t("fill_credentials"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await withAuth((tk) =>
        api<{ ok: boolean }>(`/api/v1/idoklad/credentials`, {
          method: "PUT",
          token: tk,
          body: {
            profileId: profileSyncId,
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          },
        }),
      );
      setClientId("");
      setClientSecret("");
      setEditing(false);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function clearCredentials() {
    if (!profileSyncId) return;
    if (!confirm(t("disconnect_confirm"))) return;
    try {
      await withAuth((tk) =>
        api(`/api/v1/idoklad/profiles/${profileSyncId}/credentials`, {
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
          <a href="/app/invoices" className="text-brand-600 hover:underline">{t("subtitle_link")}</a>
          {t("subtitle_post")}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : (
        <>
          {status?.configured && !editing && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-emerald-900">{t("connected")}</div>
                  <div className="text-xs text-emerald-800 mt-1">
                    {t("client_id_label")} <span className="font-mono">{status.clientId}</span>
                  </div>
                  {status.lastSyncAt && (
                    <div className="text-xs text-emerald-800 mt-0.5">
                      {t("last_sync", { date: new Date(status.lastSyncAt).toLocaleString(locale) })}
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
                  <button
                    onClick={() => setEditing(true)}
                    className="h-10 px-3 rounded-lg border border-emerald-300 text-emerald-800 text-sm hover:bg-emerald-100"
                  >
                    {t("change")}
                  </button>
                  <button
                    onClick={clearCredentials}
                    className="h-10 px-3 rounded-lg text-red-700 text-sm hover:bg-red-50"
                  >
                    {t("disconnect")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {syncResult && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 text-sm space-y-1">
              <div className="font-medium text-brand-900">{t("sync_done_total", { total: syncResult.total })}</div>
              <div className="text-brand-800">
                {t("sync_done_issued", { added: syncResult.issuedAdded, updated: syncResult.issuedUpdated })}
              </div>
              <div className="text-brand-800">
                {t("sync_done_received", { added: syncResult.receivedAdded, updated: syncResult.receivedUpdated })}
              </div>
            </div>
          )}

          {(editing || !status?.configured) && (
            <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-ink-900">
                  {status?.configured ? t("form_change_title") : t("form_connect_title")}
                </h2>
                <p className="text-sm text-ink-600 mt-1">{t("form_desc")}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-700 mb-1">{t("client_id_field")}</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="abc123…"
                  className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-700 mb-1">{t("client_secret_field")}</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveCredentials}
                  disabled={saving}
                  className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {saving ? t("saving") : t("save_test")}
                </button>
                {status?.configured && (
                  <button
                    onClick={() => { setEditing(false); setClientId(""); setClientSecret(""); }}
                    className="h-10 px-4 rounded-lg border border-ink-300 text-ink-700 text-sm hover:bg-ink-50"
                    disabled={saving}
                  >
                    {t("cancel")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-ink-200 p-6 text-sm text-ink-700 space-y-3">
            <div className="font-medium text-ink-900">{t("guide_title")}</div>
            <ol className="list-decimal list-inside space-y-1 text-ink-600">
              <li>{t("guide_step1_pre")} <a href="https://app.idoklad.cz" target="_blank" rel="noopener" className="text-brand-600 hover:text-brand-700">{t("guide_step1_link")}</a></li>
              <li>{t("guide_step2")}</li>
              <li>{t("guide_step3")}</li>
              <li>{t("guide_step4")}</li>
            </ol>
            <p className="text-xs text-ink-500 pt-2 border-t border-ink-100">{t("guide_security")}</p>
          </div>
        </>
      )}
    </div>
  );
}
