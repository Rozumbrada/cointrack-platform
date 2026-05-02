"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { withAuth } from "@/lib/auth-store";
import { admin, ApiError, AdminUserDto } from "@/lib/api";

const TIER_OPTIONS = ["FREE", "PERSONAL", "BUSINESS", "BUSINESS_PRO"];

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  // Authorization gate — server vrátí 403 pokud user není admin.
  useEffect(() => {
    (async () => {
      try {
        await withAuth((tk) => admin.check(tk));
        setAuthorized(true);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setAuthorized(false);
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setAuthorized(false);
        }
      }
    })();
  }, []);

  const load = useMemo(
    () =>
      async (q?: string) => {
        setLoading(true);
        setError(null);
        try {
          const list = await withAuth((tk) => admin.listUsers(tk, q));
          setUsers(list);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setLoading(false);
        }
      },
    [],
  );

  useEffect(() => {
    if (authorized) load();
  }, [authorized, load]);

  // Live search debounce
  useEffect(() => {
    if (!authorized) return;
    const id = setTimeout(() => load(search.trim() || undefined), 300);
    return () => clearTimeout(id);
  }, [search, authorized, load]);

  if (authorized === null) {
    return <div className="py-20 text-center text-ink-500 text-sm">Ověřuji oprávnění…</div>;
  }
  if (authorized === false) {
    return (
      <div className="max-w-md mx-auto bg-red-50 border border-red-200 rounded-2xl p-6 mt-12 text-center">
        <h1 className="text-xl font-semibold text-red-800 mb-2">Přístup odepřen</h1>
        <p className="text-sm text-red-700 mb-4">
          Tato sekce je dostupná jen administrátorům (`ADMIN_EMAILS` env).
        </p>
        <button
          onClick={() => router.push("/app/dashboard")}
          className="h-10 px-4 rounded-lg bg-ink-900 text-white text-sm"
        >
          Zpět na dashboard
        </button>
      </div>
    );
  }

  async function onUpdate(userId: string, patch: Parameters<typeof admin.updateUser>[2]) {
    try {
      const updated = await withAuth((tk) => admin.updateUser(tk, userId, patch));
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      setEditingUserId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(userId: string, email: string) {
    if (!confirm(`Smazat uživatele ${email}? (soft-delete — data zůstanou v DB)`)) return;
    try {
      await withAuth((tk) => admin.deleteUser(tk, userId));
      await load(search.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRestore(userId: string) {
    try {
      await withAuth((tk) => admin.restoreUser(tk, userId));
      await load(search.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Admin — Uživatelé</h1>
        <p className="text-sm text-ink-600 mt-1">
          Kompletní seznam uživatelů. Můžeš upravit tier, displayName, e-mail verified flag nebo
          soft-delete uživatele. Self-edit (vlastní tier / smazání) je z bezpečnosti zablokovaný.
        </p>
      </div>

      <input
        type="text"
        placeholder="Hledat email nebo jméno…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-ink-500 text-sm">Načítám…</div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-500 text-sm">
          Žádní uživatelé.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Jméno</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Email verified</th>
                <th className="px-4 py-3 font-medium">Vytvořen</th>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3 font-medium text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {users.map((u) => {
                const isEditing = editingUserId === u.id;
                return (
                  <UserRow
                    key={u.id}
                    user={u}
                    editing={isEditing}
                    onEdit={() => setEditingUserId(u.id)}
                    onCancelEdit={() => setEditingUserId(null)}
                    onUpdate={(patch) => onUpdate(u.id, patch)}
                    onDelete={() => onDelete(u.id, u.email)}
                    onRestore={() => onRestore(u.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-500">
        Celkem zobrazeno: {users.length}. (Server limit 100 — pokud chybí někdo, zužte hledání.)
      </p>
    </div>
  );
}

function UserRow({
  user,
  editing,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
  onRestore,
}: {
  user: AdminUserDto;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (patch: { tier?: string; displayName?: string; emailVerified?: boolean }) => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const [tier, setTier] = useState(user.tier);
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);

  useEffect(() => {
    setTier(user.tier);
    setDisplayName(user.displayName ?? "");
    setEmailVerified(user.emailVerified);
  }, [user]);

  const isDeleted = user.deletedAt != null;

  if (editing) {
    return (
      <tr className="bg-amber-50/40">
        <td className="px-4 py-3 text-ink-900 font-mono text-xs">{user.email}</td>
        <td className="px-4 py-3">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full h-8 rounded border border-ink-300 px-2 text-xs"
          />
        </td>
        <td className="px-4 py-3">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="h-8 rounded border border-ink-300 px-2 text-xs"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={emailVerified}
              onChange={(e) => setEmailVerified(e.target.checked)}
            />
            verified
          </label>
        </td>
        <td className="px-4 py-3 text-ink-500 text-xs">{fmtDate(user.createdAt)}</td>
        <td className="px-4 py-3">
          {isDeleted ? <span className="text-red-700 text-xs">Smazán</span> : <span className="text-emerald-700 text-xs">Aktivní</span>}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button
            onClick={() => onUpdate({ tier, displayName: displayName || undefined, emailVerified })}
            className="text-xs text-emerald-700 hover:text-emerald-800 font-medium mr-3"
          >
            Uložit
          </button>
          <button onClick={onCancelEdit} className="text-xs text-ink-500 hover:text-ink-900">
            Zrušit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`hover:bg-ink-50/50 ${isDeleted ? "opacity-50" : ""}`}>
      <td className="px-4 py-3 text-ink-900 font-mono text-xs">{user.email}</td>
      <td className="px-4 py-3 text-ink-700">{user.displayName || "—"}</td>
      <td className="px-4 py-3">
        <span className="text-xs uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
          {user.tier}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.emailVerified ? (
          <span className="text-emerald-700 text-xs">✓ ano</span>
        ) : (
          <span className="text-amber-700 text-xs">⏳ ne</span>
        )}
      </td>
      <td className="px-4 py-3 text-ink-500 text-xs">{fmtDate(user.createdAt)}</td>
      <td className="px-4 py-3">
        {isDeleted ? <span className="text-red-700 text-xs">Smazán</span> : <span className="text-emerald-700 text-xs">Aktivní</span>}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button
          onClick={onEdit}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
        >
          Upravit
        </button>
        {isDeleted ? (
          <button onClick={onRestore} className="text-xs text-emerald-700 hover:text-emerald-800">
            Obnovit
          </button>
        ) : (
          <button onClick={onDelete} className="text-xs text-red-600 hover:text-red-700">
            Smazat
          </button>
        )}
      </td>
    </tr>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}
