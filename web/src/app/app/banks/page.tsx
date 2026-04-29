"use client";

// Sprint 8 v2 — bank ↔ profile assignment UI (force rebuild marker)
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { bank, BankConnectionDto, BankAccountExtDto, ApiError, sync, api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

interface ProfileLite {
  syncId: string;
  name: string;
  type?: string;
}

export default function BanksPage() {
  const t = useTranslations("banks_page");
  const [connections, setConnections] = useState<BankConnectionDto[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [conns, syncRes] = await Promise.all([
        withAuth((t) => bank.listConnections(t)),
        withAuth((t) => sync.pull(t)),
      ]);
      setConnections(conns.connections);

      const profileEntities = (syncRes.entities["profiles"] ?? []).filter((e) => {
        if (e.deletedAt) return false;
        const d = e.data as Record<string, unknown>;
        return !(d.deletedAt != null && d.deletedAt !== 0);
      });
      setProfiles(
        profileEntities.map((e) => ({
          syncId: e.syncId,
          name: (e.data as Record<string, unknown>).name as string,
          type: (e.data as Record<string, unknown>).type as string | undefined,
        })),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await withAuth((t) => bank.connect(t, undefined, "cs"));
      window.open(res.connectUrl, "_blank", "width=500,height=700,noopener,noreferrer");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function onReconnect(id: string) {
    try {
      const res = await withAuth((t) => bank.reconnect(t, id, "cs"));
      window.open(res.connectUrl, "_blank", "width=500,height=700,noopener,noreferrer");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onDelete(id: string) {
    if (!confirm(t("delete_confirm"))) return;
    try {
      await withAuth((t) => bank.delete(t, id));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onAssign(accountId: string, profileId: string, autoImport: boolean) {
    try {
      await withAuth((t) => bank.assignToProfile(t, accountId, profileId, autoImport));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onUnassign(accountId: string, profileId: string) {
    try {
      await withAuth((t) => bank.unassignFromProfile(t, accountId, profileId));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">
            {t("subtitle_pre")} <strong>{t("subtitle_b")}</strong> {t("subtitle_post")}
          </p>
        </div>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-60"
        >
          {connecting ? t("opening") : t("add_bank")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Fio Bank přes API token — samostatný flow, ne Salt Edge */}
      <FioCard />

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : connections.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🏦</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((c) => (
            <BankCardV8
              key={c.id}
              conn={c}
              profiles={profiles}
              onReconnect={() => onReconnect(c.id)}
              onDelete={() => onDelete(c.id)}
              onAssign={onAssign}
              onUnassign={onUnassign}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-ink-500 bg-ink-50 border border-ink-200 rounded-lg p-3">
        {t("info_box")}
      </div>
    </div>
  );
}

function BankCardV8({
  conn,
  profiles,
  onReconnect,
  onDelete,
  onAssign,
  onUnassign,
}: {
  conn: BankConnectionDto;
  profiles: ProfileLite[];
  onReconnect: () => void;
  onDelete: () => void;
  onAssign: (accountId: string, profileId: string, autoImport: boolean) => void;
  onUnassign: (accountId: string, profileId: string) => void;
}) {
  const t = useTranslations("banks_page");
  const isActive = conn.status.toLowerCase() === "active";
  const expiresInDays = conn.consentExpiresAt
    ? Math.floor(
        (new Date(conn.consentExpiresAt).getTime() - Date.now()) / 86400_000,
      )
    : null;
  const warnExpiry = expiresInDays !== null && expiresInDays <= 7 && expiresInDays >= 0;

  return (
    <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-lg bg-brand-100 grid place-items-center text-brand-700 text-xl">
          🏦
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink-900 truncate">
            {conn.providerName || conn.providerCode || t("bank_default_name")}
          </div>
          <div className="text-xs text-ink-600 mt-0.5">
            <span
              className={
                isActive
                  ? "text-emerald-700"
                  : conn.status === "error"
                    ? "text-red-700"
                    : "text-ink-500"
              }
            >
              {labelStatus(conn.status, t)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {!isActive && (
            <button
              onClick={onReconnect}
              className="h-9 px-3 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 text-sm hover:bg-brand-100"
            >
              {t("renew")}
            </button>
          )}
          <button
            onClick={onDelete}
            className="h-9 px-3 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50"
          >
            {t("disconnect")}
          </button>
        </div>
      </div>

      {(warnExpiry || !isActive) && (
        <div
          className={`px-5 py-3 text-xs border-t ${
            !isActive
              ? "bg-red-50 border-red-100 text-red-800"
              : "bg-amber-50 border-amber-100 text-amber-800"
          }`}
        >
          {!isActive
            ? conn.lastError || t("not_active")
            : t("consent_expires", { days: expiresInDays!, unit: expiresInDays === 1 ? t("day") : t("days") })}
        </div>
      )}

      {conn.accounts.length > 0 && (
        <div className="border-t border-ink-100 divide-y divide-ink-100">
          {conn.accounts.map((a) => (
            <AccountRowV8
              key={a.id}
              account={a}
              profiles={profiles}
              onAssign={onAssign}
              onUnassign={onUnassign}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRowV8({
  account,
  profiles,
  onAssign,
  onUnassign,
}: {
  account: BankAccountExtDto;
  profiles: ProfileLite[];
  onAssign: (accountId: string, profileId: string, autoImport: boolean) => void;
  onUnassign: (accountId: string, profileId: string) => void;
}) {
  const t = useTranslations("banks_page");
  const [open, setOpen] = useState(false);
  const assigned = new Set(account.assignedProfileIds ?? []);
  const autoImport = new Set(account.autoImportProfileIds ?? []);
  const assignedProfiles = profiles.filter((p) => assigned.has(p.syncId));
  const unassignedProfiles = profiles.filter((p) => !assigned.has(p.syncId));

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-900 truncate">
            {account.name || account.iban || account.accountNumber || t("account_default_name")}
          </div>
          {account.iban && <div className="text-xs text-ink-500">{account.iban}</div>}
        </div>
        <div className="text-sm font-medium tabular-nums text-ink-900">
          {account.balance ?? "—"} {account.currencyCode}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {assignedProfiles.length === 0 && (
          <span className="text-xs text-ink-500 italic">{t("unassigned")}</span>
        )}
        {assignedProfiles.map((p) => (
          <span
            key={p.syncId}
            className="inline-flex items-center gap-1.5 text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-full"
          >
            {p.name}
            {autoImport.has(p.syncId) && (
              <span className="text-[9px] uppercase bg-brand-200 text-brand-800 px-1 rounded">
                {t("auto_label")}
              </span>
            )}
            <button
              onClick={() => onUnassign(account.id, p.syncId)}
              className="text-brand-600 hover:text-brand-900 -mr-1"
              title={t("unassign_from_profile")}
            >
              ×
            </button>
          </span>
        ))}

        {unassignedProfiles.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              {t("assign_to_profile")}
            </button>
            {open && (
              <div className="absolute left-0 top-full mt-1 z-10 bg-white border border-ink-200 rounded-lg shadow-lg min-w-48 max-h-60 overflow-auto">
                {unassignedProfiles.map((p) => (
                  <div key={p.syncId} className="border-b border-ink-100 last:border-0">
                    <button
                      onClick={() => {
                        onAssign(account.id, p.syncId, false);
                        setOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-ink-50"
                    >
                      <div className="font-medium text-ink-900">{p.name}</div>
                      {p.type && (
                        <div className="text-[10px] uppercase tracking-wide text-ink-500">
                          {p.type}
                        </div>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function labelStatus(s: string, t: (k: string) => string): string {
  switch (s.toLowerCase()) {
    case "active": return t("status_active");
    case "inactive": return t("status_inactive");
    case "disabled": return t("status_disabled");
    case "error": return t("status_error");
    default: return s;
  }
}


/* ───── Fio Bank card ─────────────────────────────────────────────── */

interface FioStatusDto {
  configured: boolean;
  lastSyncAt?: string;
  lastMovementId?: number;
  accountIban?: string;
}

function FioCard() {
  const t = useTranslations("banks_page");
  const [status, setStatus] = useState<FioStatusDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const profileSyncId = getCurrentProfileSyncId();
    if (!profileSyncId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await withAuth((tk) =>
          api<FioStatusDto>(`/api/v1/fio/profiles/${profileSyncId}/status`, {
            token: tk,
          }),
        );
        if (!cancelled) setStatus(s);
      } catch {
        // ignore — Fio status je nice-to-have, ne kritický
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  return (
    <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-lg bg-amber-100 grid place-items-center text-amber-700 text-xl">
          🟢
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink-900">{t("fio_card_title")}</div>
          <div className="text-xs text-ink-600 mt-0.5">
            {status?.configured ? (
              <span className="text-emerald-700">
                ✓ {t("fio_connected")}
                {status.accountIban && (
                  <span className="ml-2 font-mono text-ink-500">
                    {status.accountIban}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-ink-500">{t("fio_not_connected")}</span>
            )}
          </div>
        </div>
        <Link
          href="/app/fio"
          className="h-9 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium grid place-items-center"
        >
          {status?.configured ? t("fio_manage") : t("fio_setup")}
        </Link>
      </div>
    </div>
  );
}
