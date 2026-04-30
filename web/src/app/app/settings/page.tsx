"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth, gdpr, DeletionStatusDto, UserDto } from "@/lib/api";
import { clearAuth, getAccessToken } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import {
  getDefaultAccountSyncId,
  setDefaultAccountSyncId,
} from "@/lib/profile-store";
import { tierDisplayName } from "@/lib/tier";
import {
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  getAutoSyncIntervalMinutes,
  setAutoSyncIntervalMinutes,
} from "@/lib/auto-sync-settings";

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
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

  // Auto-sync state — read once z localStorage, write through na change.
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(true);
  const [autoSyncInterval, setAutoSyncIntervalState] = useState(30);
  useEffect(() => {
    setAutoSyncEnabledState(isAutoSyncEnabled());
    setAutoSyncIntervalState(getAutoSyncIntervalMinutes());
  }, []);
  function onToggleAutoSync(v: boolean) {
    setAutoSyncEnabledState(v);
    setAutoSyncEnabled(v);
  }
  function onChangeAutoSyncInterval(v: number) {
    if (!Number.isFinite(v) || v <= 0) return;
    setAutoSyncIntervalState(v);
    setAutoSyncIntervalMinutes(v);
  }

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
      setError(t("export_failed", { error: String(e) }));
    }
  }

  async function onRequestDeletion() {
    const token = getAccessToken();
    if (!token) return;
    if (!confirm(t("delete_confirm"))) return;
    setDeletionBusy(true);
    try {
      const res = await gdpr.requestDeletion(token);
      setDeletion(res);
      setTimeout(() => onLogout(), 2000);
    } catch (e) {
      setError(t("delete_failed", { error: String(e) }));
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
      setError(t("cancel_failed", { error: String(e) }));
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
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-4">{t("account_section")}</h2>
        <dl className="space-y-3 text-sm">
          <Row label={tc("email")} value={user?.email} />
          <Row label={t("name_field")} value={user?.displayName ?? "—"} />
          <Row label={t("language_field")} value={user?.locale ?? "—"} />
          <Row
            label={t("tier_field")}
            value={
              <span className="inline-block text-xs tracking-wide bg-brand-100 text-brand-700 px-2 py-0.5 rounded">
                {tierDisplayName(user?.tier)}
              </span>
            }
          />
          <Row
            label={t("verified_email")}
            value={user?.emailVerified ? t("yes_verified") : t("not_verified")}
          />
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-3">
        <div>
          <h2 className="font-semibold text-ink-900 mb-2">{t("auto_sync_section")}</h2>
          <p className="text-sm text-ink-600">{t("auto_sync_desc")}</p>
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            onChange={(e) => onToggleAutoSync(e.target.checked)}
            className="mt-1"
          />
          <div>
            <span className="text-sm text-ink-900 block">{t("auto_sync_enabled_label")}</span>
            <span className="text-xs text-ink-500">{t("auto_sync_enabled_hint")}</span>
          </div>
        </label>
        {autoSyncEnabled && (
          <div className="pl-6">
            <label className="block text-xs text-ink-700 mb-1">
              {t("auto_sync_interval_label")}
            </label>
            <select
              value={autoSyncInterval}
              onChange={(e) => onChangeAutoSyncInterval(parseInt(e.target.value, 10))}
              className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900"
            >
              {[15, 30, 60, 120, 240].map((m) => (
                <option key={m} value={m}>
                  {t("auto_sync_interval_minutes", { count: m })}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">{t("default_account_section")}</h2>
        <p className="text-sm text-ink-600 mb-3">{t("default_account_desc")}</p>
        <select
          value={defaultAccount}
          onChange={(e) => onChangeDefaultAccount(e.target.value)}
          className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900"
        >
          <option value="">{t("default_account_none")}</option>
          {nonCashAccounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">{t("mobile_section")}</h2>
        <p className="text-sm text-ink-600 mb-4">{t("mobile_desc")}</p>
        <a
          href="/download/latest.apk"
          className="inline-block h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
        >
          {t("mobile_download")}
        </a>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6">
        <h2 className="font-semibold text-ink-900 mb-2">{t("gdpr_section")}</h2>
        <p className="text-sm text-ink-600 mb-4">{t("gdpr_desc")}</p>
        <button
          onClick={onExportData}
          className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
        >
          {t("gdpr_download")}
        </button>
      </section>

      {deletion?.requestedAt ? (
        <section className="bg-amber-50 rounded-2xl border border-amber-300 p-6">
          <h2 className="font-semibold text-amber-900 mb-2">{t("delete_pending_title")}</h2>
          <p className="text-sm text-amber-900 mb-4">
            {t("delete_pending_requested", { date: new Date(deletion.requestedAt).toLocaleString() })}{" "}
            <b>{deletion.deleteAfterAt && new Date(deletion.deleteAfterAt).toLocaleDateString()}</b>.{" "}
            {t("delete_pending_changed_mind")}
          </p>
          {deletion.canCancel && (
            <button
              onClick={onCancelDeletion}
              disabled={deletionBusy}
              className="h-10 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 text-white text-sm font-medium"
            >
              {t("cancel_deletion")}
            </button>
          )}
        </section>
      ) : (
        <section className="bg-white rounded-2xl border border-red-200 p-6">
          <h2 className="font-semibold text-red-800 mb-2">{t("delete_account_section")}</h2>
          <p className="text-sm text-ink-600 mb-4">{t("delete_account_desc")}</p>
          <button
            onClick={onRequestDeletion}
            disabled={deletionBusy}
            className="h-10 px-4 rounded-lg border border-red-300 bg-white hover:bg-red-50 text-sm font-medium text-red-800 disabled:opacity-50"
          >
            {t("delete_account_btn")}
          </button>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-red-200 p-6">
        <h2 className="font-semibold text-red-800 mb-2">{t("logout_section")}</h2>
        <p className="text-sm text-ink-600 mb-4">{t("logout_desc")}</p>
        <button
          onClick={onLogout}
          className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
        >
          {t("logout_btn")}
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
