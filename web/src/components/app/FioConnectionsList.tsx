"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api, sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

/**
 * Per-connection metadata (V27 multi-credential).
 * `id` je UUID matching mobilní FioAccount.syncId.
 */
interface FioConnectionDto {
  id: string;
  name: string;
  accountIban?: string | null;
  lastSyncAt?: string | null;
  lastMovementId?: number | null;
}

interface ConnectionsResponse {
  connections: FioConnectionDto[];
}

interface SyncResult {
  added: number;
  skipped: number;
  accountIban?: string | null;
  lastMovementId?: number | null;
}

/**
 * List všech Fio připojení daného profilu.
 *
 * Backend endpoint `/api/v1/fio/profiles/{profileId}/connections` vrací
 * seznam BEZ tokenů — jen metadata (name, IBAN, lastSync). Token zůstává
 * šifrovaný na serveru a po prvním uložení už nikdy neopustí backend.
 *
 * Funkce:
 *  - List všech připojení s IBAN + last sync
 *  - Přidat nové (name + token)
 *  - Změnit jméno nebo token (existující edit)
 *  - Smazat
 *  - Sync jednotlivého připojení
 */
export function FioConnectionsList() {
  const t = useTranslations("fio_page");
  const [profileSyncId, setProfileSyncId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [connections, setConnections] = useState<FioConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add / edit / delete / sync per-row state
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: string; result: SyncResult } | null>(null);

  // Reaktivně sleduj přepnutí profilu (cointrack:profile-changed)
  useEffect(() => {
    setProfileSyncId(getCurrentProfileSyncId());
    const onChange = () => {
      setProfileSyncId(getCurrentProfileSyncId());
      setSyncResult(null);
    };
    window.addEventListener("cointrack:profile-changed", onChange);
    return () => window.removeEventListener("cointrack:profile-changed", onChange);
  }, []);

  // Načti název profilu (pro popisek "Pro profil: …")
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

  async function loadConnections() {
    if (!profileSyncId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await withAuth((tk) =>
        api<ConnectionsResponse>(
          `/api/v1/fio/profiles/${profileSyncId}/connections`,
          { token: tk },
        ),
      );
      setConnections(res.connections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSyncId]);

  async function handleSync(id: string) {
    setBusyId(id);
    setError(null);
    setSyncResult(null);
    try {
      const r = await withAuth((tk) =>
        api<SyncResult>(`/api/v1/fio/connections/${id}/sync`, { method: "POST", token: tk }),
      );
      setSyncResult({ id, result: r });
      await loadConnections();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(t("delete_connection_confirm", { name }))) return;
    setBusyId(id);
    try {
      await withAuth((tk) =>
        api(`/api/v1/fio/connections/${id}`, { method: "DELETE", token: tk }),
      );
      await loadConnections();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
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
              <span className="ml-2 text-ink-400">— {t("multi_per_profile_hint")}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
          }}
          className="shrink-0 h-9 px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("add_connection_btn")}
        </button>
      </div>

      <div className="p-5 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {syncResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
            {t("sync_result_named", {
              name: connections.find((c) => c.id === syncResult.id)?.name ?? "?",
              added: syncResult.result.added,
              skipped: syncResult.result.skipped,
            })}
          </div>
        )}

        {adding && (
          <ConnectionForm
            mode="create"
            profileSyncId={profileSyncId}
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await loadConnections();
            }}
          />
        )}

        {loading ? (
          <div className="py-6 text-center text-ink-500 text-sm">{t("loading")}</div>
        ) : connections.length === 0 && !adding ? (
          <div className="py-8 text-center text-ink-500 text-sm">
            {t("no_connections_yet")}
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {connections.map((c) => (
              <li key={c.id} className="py-3">
                {editingId === c.id ? (
                  <ConnectionForm
                    mode="edit"
                    connection={c}
                    profileSyncId={profileSyncId}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await loadConnections();
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink-900 flex items-center gap-2">
                        <span>{c.name}</span>
                        <span className="inline-flex items-center text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                          ✓ {t("connected_short")}
                        </span>
                      </div>
                      {c.accountIban && (
                        <div className="text-xs text-ink-500 mt-1 font-mono">
                          {t("iban")}: {c.accountIban}
                        </div>
                      )}
                      {c.lastSyncAt ? (
                        <div className="text-xs text-ink-500 mt-0.5">
                          {t("last_sync")}: {new Date(c.lastSyncAt).toLocaleString("cs-CZ")}
                        </div>
                      ) : (
                        <div className="text-xs text-amber-700 mt-0.5">{t("never_synced")}</div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleSync(c.id)}
                        disabled={busyId === c.id}
                        className="h-8 px-3 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                      >
                        {busyId === c.id ? t("syncing") : t("sync_btn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setAdding(false);
                        }}
                        disabled={busyId === c.id}
                        className="h-8 px-3 rounded text-xs border border-ink-300 text-ink-700 hover:bg-ink-50"
                      >
                        {t("change")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id, c.name)}
                        disabled={busyId === c.id}
                        className="h-8 px-3 rounded text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("disconnect")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="text-xs text-ink-500 pt-3 border-t border-ink-100">
          {t("after_sync_pre")}{" "}
          <Link href="/app/transactions" className="text-brand-600 hover:underline">
            {t("after_sync_link")}
          </Link>
          {t("after_sync_post")}
        </div>
      </div>
    </div>
  );
}

/* ────── Sub-component: form pro create/edit ─────────────────────────── */

function ConnectionForm({
  mode,
  connection,
  profileSyncId,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  connection?: FioConnectionDto;
  profileSyncId: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("fio_page");
  const [name, setName] = useState(connection?.name ?? "");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (mode === "create") {
      // Name required (default "Fio účet" pokud user nezadá)
      if (!token.trim() || token.trim().length < 20) {
        setErr(t("invalid_token"));
        return;
      }
    } else {
      // Edit: aspoň jeden field musí být změněn
      if (!name.trim() && !token.trim()) {
        setErr(t("nothing_to_change"));
        return;
      }
    }
    setSaving(true);
    try {
      if (mode === "create") {
        await withAuth((tk) =>
          api(`/api/v1/fio/profiles/${profileSyncId}/connections`, {
            method: "POST",
            token: tk,
            body: {
              name: name.trim() || "Fio účet",
              token: token.trim(),
            },
          }),
        );
      } else if (connection) {
        await withAuth((tk) =>
          api(`/api/v1/fio/connections/${connection.id}`, {
            method: "PATCH",
            token: tk,
            body: {
              ...(name.trim() && name.trim() !== connection.name ? { name: name.trim() } : {}),
              ...(token.trim() ? { token: token.trim() } : {}),
            },
          }),
        );
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-ink-50 border border-ink-200 rounded-lg p-3 space-y-3">
      <div className="font-medium text-ink-900 text-sm">
        {mode === "create" ? t("form_connect_title") : t("form_change_title")}
      </div>

      <label className="block">
        <div className="text-xs font-medium text-ink-700 mb-1">{t("connection_name_label")}</div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("connection_name_placeholder")}
          className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
        />
      </label>

      <label className="block">
        <div className="text-xs font-medium text-ink-700 mb-1">{t("token_label")}</div>
        <div className="relative">
          <input
            type={tokenVisible ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={mode === "edit" ? t("token_keep_existing_placeholder") : "aB12cD34eF…"}
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
        {mode === "edit" && (
          <p className="text-xs text-ink-500 mt-1">{t("token_keep_hint")}</p>
        )}
      </label>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">
          {err}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-9 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
