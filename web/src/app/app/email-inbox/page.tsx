"use client";

import { useEffect, useState } from "react";
import {
  emailInbox,
  EmailInboxAccountDto,
  EmailInboxCreateRequest,
  EmailInboxUpdateRequest,
  ApiError,
} from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

const KNOWN_HOSTS: Record<string, { host: string; port: number; ssl: boolean; note?: string }> = {
  "seznam.cz":     { host: "imap.seznam.cz", port: 993, ssl: true },
  "email.cz":      { host: "imap.seznam.cz", port: 993, ssl: true },
  "post.cz":       { host: "imap.seznam.cz", port: 993, ssl: true },
  "wedos.cz":      { host: "wes1-imap.wedos.net", port: 993, ssl: true },
  "wedos.com":     { host: "wes1-imap.wedos.net", port: 993, ssl: true },
  "centrum.cz":    { host: "imap.centrum.cz", port: 993, ssl: true },
  "atlas.cz":      { host: "imap.atlas.cz", port: 993, ssl: true },
  "volny.cz":      { host: "imap.volny.cz", port: 993, ssl: true },
  "gmail.com":     { host: "imap.gmail.com", port: 993, ssl: true, note: "Gmail vyžaduje App Password (Settings → Security → 2-Step → App passwords)." },
  "outlook.com":   { host: "outlook.office365.com", port: 993, ssl: true, note: "Outlook vyžaduje App Password při zapnutém 2FA." },
  "hotmail.com":   { host: "outlook.office365.com", port: 993, ssl: true },
};

function detectHostFromEmail(email: string) {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return KNOWN_HOSTS[domain] ?? null;
}

export default function EmailInboxPage() {
  const [profileSyncId, setProfileSyncId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<EmailInboxAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailInboxAccountDto | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProfileSyncId(getCurrentProfileSyncId());
    function refresh() {
      setProfileSyncId(getCurrentProfileSyncId());
    }
    window.addEventListener("cointrack:profile-changed", refresh);
    return () => window.removeEventListener("cointrack:profile-changed", refresh);
  }, []);

  async function load() {
    if (!profileSyncId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await withAuth((tk) => emailInbox.list(tk, profileSyncId));
      setAccounts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profileSyncId]);

  async function onSync(id: string) {
    if (!profileSyncId) return;
    setSyncingId(id);
    setInfo(null);
    setError(null);
    try {
      const res = await withAuth((tk) => emailInbox.sync(tk, id, profileSyncId));
      setInfo(
        res.ok
          ? `Sync OK — zpracováno ${res.processed}, vytvořeno ${res.invoicesCreated} faktur, přeskočeno ${res.skipped}.`
          : `Sync s chybou: ${res.error ?? "neznámá"}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingId(null);
    }
  }

  async function onDelete(id: string, label: string) {
    if (!profileSyncId) return;
    if (!confirm(`Smazat schránku "${label}"?\n\n(Stažené faktury zůstanou.)`)) return;
    try {
      await withAuth((tk) => emailInbox.remove(tk, id, profileSyncId));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!profileSyncId) {
    return <div className="py-20 text-center text-ink-500 text-sm">Nejdřív vyber profil v menu vlevo.</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Emailové schránky</h1>
        <p className="text-sm text-ink-600 mt-1">
          Cointrack pravidelně stahuje nové emaily z propojených schránek a vytahuje
          z příloh i textu faktury. Pokud najde matching bankovní transakci,
          označí fakturu za zaplacenou. Server čte jen tělo a přílohy — emaily samy
          se nepersistují.
        </p>
      </div>

      {info && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
          {info}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        onClick={() => setShowCreate(true)}
        className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
      >
        + Přidat schránku
      </button>

      {loading ? (
        <div className="py-12 text-center text-ink-500 text-sm">Načítám…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-500 text-sm">
          Žádná schránka zatím není připojená.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 font-medium">Schránka</th>
                <th className="px-4 py-3 font-medium">Host</th>
                <th className="px-4 py-3 font-medium">Sync</th>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3 font-medium text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-ink-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">{acc.displayLabel ?? acc.imapUsername}</div>
                    <div className="text-xs text-ink-500 font-mono">{acc.imapUsername}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600 font-mono">
                    {acc.imapHost}:{acc.imapPort}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600">
                    Každých {acc.syncIntervalHours}h
                    {acc.lastSyncedAt && (
                      <div className="text-ink-400">
                        Poslední: {new Date(acc.lastSyncedAt).toLocaleString("cs-CZ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {!acc.enabled && <span className="text-ink-400">Vypnuto</span>}
                    {acc.enabled && acc.lastSyncError && (
                      <span className="text-red-700" title={acc.lastSyncError}>⚠ Chyba</span>
                    )}
                    {acc.enabled && !acc.lastSyncError && (
                      <span className="text-emerald-700">✓ Aktivní</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => onSync(acc.id)}
                      disabled={syncingId === acc.id}
                      className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3 disabled:opacity-50"
                    >
                      {syncingId === acc.id ? "Sync…" : "Sync teď"}
                    </button>
                    <button
                      onClick={() => setEditing(acc)}
                      className="text-xs text-ink-600 hover:text-ink-900 mr-3"
                    >
                      Upravit
                    </button>
                    <button
                      onClick={() => onDelete(acc.id, acc.displayLabel ?? acc.imapUsername ?? "")}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && profileSyncId && (
        <AccountDialog
          profileSyncId={profileSyncId}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {editing && profileSyncId && (
        <AccountDialog
          profileSyncId={profileSyncId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Add/Edit dialog ────────────────────────────────────────────────

function AccountDialog({
  profileSyncId,
  existing,
  onClose,
  onSaved,
}: {
  profileSyncId: string;
  existing?: EmailInboxAccountDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const [displayLabel, setDisplayLabel] = useState(existing?.displayLabel ?? "");
  const [imapHost, setImapHost] = useState(existing?.imapHost ?? "");
  const [imapPort, setImapPort] = useState(String(existing?.imapPort ?? 993));
  const [imapUsername, setImapUsername] = useState(existing?.imapUsername ?? "");
  const [imapPassword, setImapPassword] = useState("");
  const [imapSsl, setImapSsl] = useState(existing?.imapSsl ?? true);
  const [folder, setFolder] = useState(existing?.folder ?? "INBOX");
  const [senderWhitelist, setSenderWhitelist] = useState(existing?.senderWhitelist ?? "");
  const [subjectFilter, setSubjectFilter] = useState(existing?.subjectFilter ?? "");
  const [syncIntervalHours, setSyncIntervalHours] = useState(String(existing?.syncIntervalHours ?? 6));

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostNote, setHostNote] = useState<string | null>(null);

  // Auto-detect IMAP host z email domény
  function onUsernameChange(value: string) {
    setImapUsername(value);
    if (!isEdit && !imapHost) {
      const detected = detectHostFromEmail(value);
      if (detected) {
        setImapHost(detected.host);
        setImapPort(String(detected.port));
        setImapSsl(detected.ssl);
        setHostNote(detected.note ?? null);
      }
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await withAuth((tk) =>
        emailInbox.testConnection(tk, {
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort) || 993,
          imapUsername: imapUsername.trim(),
          imapPassword: imapPassword || "",
          imapSsl,
        }),
      );
      setTestResult(res.ok ? `✓ ${res.message}` : `✗ ${res.message}`);
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    setError(null);
    if (!imapHost.trim() || !imapUsername.trim()) {
      setError("Vyplň host a email/username.");
      return;
    }
    if (!isEdit && !imapPassword) {
      setError("Heslo je povinné při vytváření.");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const payload: EmailInboxUpdateRequest = {
          displayLabel: displayLabel.trim() || undefined,
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort) || 993,
          imapUsername: imapUsername.trim(),
          ...(imapPassword ? { imapPassword } : {}),
          imapSsl,
          folder: folder.trim() || "INBOX",
          senderWhitelist: senderWhitelist.trim() || undefined,
          subjectFilter: subjectFilter.trim() || undefined,
          syncIntervalHours: parseInt(syncIntervalHours) || 6,
        };
        await withAuth((tk) => emailInbox.update(tk, existing!.id, profileSyncId, payload));
      } else {
        const payload: EmailInboxCreateRequest = {
          displayLabel: displayLabel.trim() || undefined,
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort) || 993,
          imapUsername: imapUsername.trim(),
          imapPassword,
          imapSsl,
          folder: folder.trim() || "INBOX",
          senderWhitelist: senderWhitelist.trim() || undefined,
          subjectFilter: subjectFilter.trim() || undefined,
          syncIntervalHours: parseInt(syncIntervalHours) || 6,
        };
        await withAuth((tk) => emailInbox.create(tk, profileSyncId, payload));
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message}` : (e instanceof Error ? e.message : String(e));
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-ink-900">
          {isEdit ? "Upravit schránku" : "Přidat schránku"}
        </h2>

        <Field label="Název (pro tvou orientaci)">
          <input
            type="text"
            value={displayLabel}
            onChange={(e) => setDisplayLabel(e.target.value)}
            placeholder="Faktury — mojefirma.cz"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          />
        </Field>

        <Field label="Email / username">
          <input
            type="email"
            value={imapUsername}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="info@mojefirma.cz"
            autoComplete="email"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
          />
        </Field>

        <Field label={isEdit ? "Heslo (vynech pro zachování)" : "Heslo / App password"}>
          <input
            type="password"
            value={imapPassword}
            onChange={(e) => setImapPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          />
          {hostNote && (
            <div className="text-xs text-amber-700 mt-1">{hostNote}</div>
          )}
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="IMAP host">
              <input
                type="text"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.seznam.cz"
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
              />
            </Field>
          </div>
          <Field label="Port">
            <input
              type="number"
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={imapSsl} onChange={(e) => setImapSsl(e.target.checked)} />
          SSL / TLS
        </label>

        <details className="text-sm">
          <summary className="cursor-pointer text-ink-600 hover:text-ink-900 select-none">
            ▾ Pokročilé (filtry, interval)
          </summary>
          <div className="mt-3 space-y-3">
            <Field label="Folder">
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="INBOX"
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
              />
            </Field>
            <Field label="Sender whitelist (CSV emailů, volitelné)">
              <input
                type="text"
                value={senderWhitelist}
                onChange={(e) => setSenderWhitelist(e.target.value)}
                placeholder="faktury@dodavatel.cz,billing@..."
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
              />
            </Field>
            <Field label="Subject regex filter (volitelné — prázdné = všechny)">
              <input
                type="text"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                placeholder="fakt|invoice|daňový"
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
              />
            </Field>
            <Field label="Sync interval (hodiny)">
              <select
                value={syncIntervalHours}
                onChange={(e) => setSyncIntervalHours(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              >
                <option value="1">1 hodina</option>
                <option value="6">6 hodin (default)</option>
                <option value="12">12 hodin</option>
                <option value="24">24 hodin</option>
              </select>
            </Field>
          </div>
        </details>

        {testResult && (
          <div className={`text-sm ${testResult.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>
            {testResult}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={saving || testing}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            Zrušit
          </button>
          <button
            onClick={onTest}
            disabled={testing || !imapHost || !imapUsername || (!isEdit && !imapPassword)}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-700 disabled:opacity-50"
          >
            {testing ? "Testuji…" : "Test připojení"}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 h-10 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {saving ? "Ukládám…" : isEdit ? "Uložit" : "Vytvořit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-ink-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

