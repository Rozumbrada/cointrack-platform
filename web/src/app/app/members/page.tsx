"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  accountShares,
  ApiError,
  ShareWithAccountDto,
  auth,
  UserDto,
} from "@/lib/api";
import { withAuth, getAccessToken } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";

export default function MembersPage() {
  const t = useTranslations("members_page");
  const [shares, setShares] = useState<ShareWithAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const { entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await withAuth((tk) => accountShares.listOwned(tk));
      setShares(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      auth.me(token).then(setUser).catch(() => {});
    }
    load();
  }, []);

  const isOrganizationTier = user?.tier === "ORGANIZATION";

  async function onRevoke(share: ShareWithAccountDto) {
    if (!confirm(t("revoke_confirm", { email: share.email, account: share.accountName }))) return;
    try {
      await withAuth((tk) => accountShares.revoke(tk, share.id));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        {isOrganizationTier && (
          <button
            onClick={() => setShowDialog(true)}
            disabled={accounts.length === 0}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {t("add_member")}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!isOrganizationTier && user && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h2 className="font-semibold text-amber-900 mb-2">{t("tier_required_title")}</h2>
          <p className="text-sm text-amber-900 mb-4">{t("tier_required_desc")}</p>
          <Link
            href="/app/upgrade"
            className="inline-block h-10 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium leading-[2.5rem]"
          >
            {t("go_upgrade")}
          </Link>
        </section>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : shares.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2 max-w-md mx-auto">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_email")}</th>
                <th className="px-6 py-3 font-medium">{t("th_account")}</th>
                <th className="px-6 py-3 font-medium">{t("th_role")}</th>
                <th className="px-6 py-3 font-medium">{t("th_status")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {shares.map((s) => (
                <tr key={s.id} className="hover:bg-ink-50/50">
                  <td className="px-6 py-3 text-ink-900">
                    {s.userDisplayName ? (
                      <span>
                        <span className="font-medium">{s.userDisplayName}</span>
                        <span className="text-ink-500 text-xs ml-2">{s.email}</span>
                      </span>
                    ) : (
                      s.email
                    )}
                  </td>
                  <td className="px-6 py-3 text-ink-700">
                    <span>{s.accountName}</span>
                    <span className="text-xs text-ink-400 ml-1.5">({s.accountCurrency} · {s.profileName})</span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
                      {s.role === "EDITOR" ? t("role_editor") : t("role_viewer")}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {s.status === "active" && (
                      <span className="text-emerald-700 text-xs font-medium">{t("status_active")}</span>
                    )}
                    {s.status === "pending" && (
                      <span className="text-amber-700 text-xs font-medium">{t("status_pending")}</span>
                    )}
                    {s.status === "revoked" && (
                      <span className="text-ink-500 text-xs">{t("status_revoked")}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => onRevoke(s)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      {t("revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && (
        <InviteDialog
          accounts={accounts}
          onClose={() => setShowDialog(false)}
          onCreated={async () => {
            setShowDialog(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: Array<{ syncId: string; data: ServerAccount }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("members_page");
  const [email, setEmail] = useState("");
  const [accountSyncId, setAccountSyncId] = useState(accounts[0]?.syncId ?? "");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sort accounts alphabetically
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [accounts],
  );

  async function send() {
    if (!email.trim() || !email.includes("@")) {
      setErr(t("dialog_invalid_email"));
      return;
    }
    if (!accountSyncId) return;
    setSending(true);
    setErr(null);
    try {
      await withAuth((tk) => accountShares.invite(tk, accountSyncId, email.trim().toLowerCase(), role));
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-md w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold text-ink-900">{t("dialog_title")}</h2>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">{t("dialog_email")}</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            autoFocus
          />
        </label>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">{t("dialog_account")}</div>
          {sortedAccounts.length === 0 ? (
            <p className="text-xs text-amber-700">{t("dialog_no_accounts")}</p>
          ) : (
            <select
              value={accountSyncId}
              onChange={(e) => setAccountSyncId(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            >
              {sortedAccounts.map((a) => (
                <option key={a.syncId} value={a.syncId}>
                  {a.data.name} ({a.data.currency})
                </option>
              ))}
            </select>
          )}
        </label>

        <div>
          <div className="text-xs font-medium text-ink-700 mb-2">{t("dialog_role")}</div>
          <div className="space-y-2">
            <label className="flex gap-2 p-3 rounded-lg border border-ink-200 hover:border-brand-300 cursor-pointer">
              <input
                type="radio"
                checked={role === "VIEWER"}
                onChange={() => setRole("VIEWER")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-ink-900">{t("role_viewer")}</div>
                <div className="text-xs text-ink-600 mt-0.5">{t("dialog_role_viewer_desc")}</div>
              </div>
            </label>
            <label className="flex gap-2 p-3 rounded-lg border border-ink-200 hover:border-brand-300 cursor-pointer">
              <input
                type="radio"
                checked={role === "EDITOR"}
                onChange={() => setRole("EDITOR")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-ink-900">{t("role_editor")}</div>
                <div className="text-xs text-ink-600 mt-0.5">{t("dialog_role_editor_desc")}</div>
              </div>
            </label>
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{err}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            {t("dialog_cancel")}
          </button>
          <button
            onClick={send}
            disabled={sending || !accountSyncId}
            className="flex-1 h-10 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {sending ? t("dialog_sending") : t("dialog_send")}
          </button>
        </div>
      </div>
    </div>
  );
}
