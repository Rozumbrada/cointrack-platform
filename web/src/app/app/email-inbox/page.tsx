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

/** Provider-specific instrukce + IMAP konfigurace. */
interface ProviderInfo {
  id: string;
  label: string;          // pro UI ("Gmail", "Seznam.cz", …)
  domains: string[];      // emailové domény spadající pod providera
  host: string;
  port: number;
  ssl: boolean;
  /** Vyžaduje App password? (= klasické heslo nestačí, jen separate auth token) */
  requiresAppPassword: "always" | "when-2fa" | "never";
  /** Krok-za-krokem návod jak se dostat k app password / IMAP heslu. */
  instructions: { step: string; link?: { label: string; href: string } }[];
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "gmail",
    label: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    host: "imap.gmail.com", port: 993, ssl: true,
    requiresAppPassword: "always",
    instructions: [
      { step: "Gmail od r. 2022 zablokoval IMAP s běžným heslem — vyžaduje App Password." },
      { step: "Otevři Google účet → Bezpečnost.", link: { label: "Otevřít Bezpečnost Google účtu", href: "https://myaccount.google.com/security" } },
      { step: "Zapni 2-Step Verification (pokud ještě nemáš)." },
      { step: "Přejdi na App passwords.", link: { label: "Otevřít App passwords", href: "https://myaccount.google.com/apppasswords" } },
      { step: "App name: \"Cointrack\". Klik Create — Google ti ukáže 16-znakové heslo (s mezerami)." },
      { step: "Zkopíruj ho a vlož sem (mezery můžeš nechat, nebo smazat — fungují obojí)." },
    ],
  },
  {
    id: "seznam",
    label: "Seznam.cz",
    domains: ["seznam.cz", "email.cz", "post.cz", "spoluzaci.cz"],
    host: "imap.seznam.cz", port: 993, ssl: true,
    requiresAppPassword: "when-2fa",
    instructions: [
      { step: "Bez 2FA: stačí klasické heslo, kterým se přihlašuješ na seznam.cz." },
      { step: "S 2FA: vytvoř Heslo pro aplikace třetích stran.", link: { label: "Otevřít nastavení Seznam emailu", href: "https://email.seznam.cz/" } },
      { step: "V emailu: Nastavení (ozubené kolo) → Bezpečnost → Hesla pro externí aplikace → Vytvořit nové." },
      { step: "Pojmenuj např. \"Cointrack\", zkopíruj vygenerované heslo a vlož sem." },
    ],
  },
  {
    id: "wedos",
    label: "Wedos Mailhosting",
    domains: ["wedos.cz", "wedos.com"],
    host: "wes1-imap.wedos.net", port: 993, ssl: true,
    requiresAppPassword: "never",
    instructions: [
      { step: "Wedos nemá 2FA — stačí klasické heslo, kterým se přihlašuješ do webmail.wedos.cz." },
      { step: "Pokud nevíš heslo: Zákaznická administrace → E-mailové účty → klikni na účet → Změnit heslo.", link: { label: "Otevřít Wedos administraci", href: "https://client.wedos.com/" } },
      { step: "IMAP host bývá `wes1-imap.wedos.net` nebo `wes1-out.wedos.net`. Pokud jeden nefunguje, zkus druhý." },
    ],
  },
  {
    id: "outlook",
    label: "Outlook / Office 365",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    host: "outlook.office365.com", port: 993, ssl: true,
    requiresAppPassword: "when-2fa",
    instructions: [
      { step: "Bez 2FA: klasické heslo Microsoft účtu." },
      { step: "S 2FA: vytvoř App Password.", link: { label: "Otevřít Microsoft Security", href: "https://account.microsoft.com/security" } },
      { step: "V Security → Advanced security options → App passwords → Create a new app password." },
      { step: "Zkopíruj heslo a vlož sem." },
    ],
  },
  {
    id: "centrum",
    label: "Centrum / Atlas / Volný",
    domains: ["centrum.cz", "atlas.cz", "volny.cz"],
    host: "imap.centrum.cz", port: 993, ssl: true,
    requiresAppPassword: "never",
    instructions: [
      { step: "Centrum/Atlas/Volný — IMAP s klasickým heslem do webmailu funguje." },
      { step: "Centrum.cz host: `imap.centrum.cz` (i pro atlas.cz, volny.cz)." },
    ],
  },
];

function detectProvider(email: string): ProviderInfo | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
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
        <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
          <div className="text-center text-ink-700">
            <div className="text-3xl mb-2">📧</div>
            <h2 className="font-semibold text-ink-900 mb-1">Začni propojením první schránky</h2>
            <p className="text-sm text-ink-600">
              Klikni „+ Přidat schránku" výše a postupuj podle průvodce.
            </p>
          </div>
          <div className="border-t border-ink-100 pt-4">
            <h3 className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-2">
              Jak to celé funguje
            </h3>
            <ol className="text-sm text-ink-700 space-y-1.5 list-decimal list-inside">
              <li>Zadáš email + heslo (nebo app password — průvodce ti řekne kde ho vzít).</li>
              <li>Cointrack pravidelně přečte nové emaily v té schránce (server stahuje jen tělo + přílohy, maily samé se nepersistují).</li>
              <li>AI rozezná, který email obsahuje fakturu (přílohu PDF/JPG, nebo fakturu v textu).</li>
              <li>Vytvoří záznam ve <em>Faktury</em> včetně IČO, dodavatele, položek, VS a celkové částky.</li>
              <li>Pokud najde matching bankovní transakci (částka + datum), označí ji za zaplacenou.</li>
              <li>Jinak ji uvidíš jako nezaplacenou — klikneš <em>💰 Zaplatit</em>, vybereš účet, hotovo.</li>
            </ol>
          </div>
          <div className="border-t border-ink-100 pt-4 text-xs text-ink-500">
            <strong>Bezpečnost:</strong> hesla šifrujeme AES-256-GCM předtím, než je zapíšeme
            do DB. Klíč je na serveru v env proměnné, do logů se hesla nikdy nedostanou.
          </div>
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
  const [provider, setProvider] = useState<ProviderInfo | null>(
    existing ? detectProvider(existing.imapUsername ?? "") : null,
  );

  // Auto-detect IMAP host z email domény + nastav pro UI provider info (instrukce)
  function onUsernameChange(value: string) {
    setImapUsername(value);
    const detected = detectProvider(value);
    if (detected) {
      setProvider(detected);
      // Při create vyplníme automaticky. Při edit nepřepisujeme (user už mohl
      // host přizpůsobit).
      if (!isEdit) {
        setImapHost(detected.host);
        setImapPort(String(detected.port));
        setImapSsl(detected.ssl);
      }
    } else {
      setProvider(null);
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
          {provider && (
            <div className="text-xs text-emerald-700 mt-1">
              ✓ Detekováno: {provider.label}
            </div>
          )}
        </Field>

        {/* Provider-specific instrukce — auto-zobrazí když je detekovaný provider */}
        {provider && (
          <ProviderInstructions provider={provider} />
        )}
        {!provider && imapUsername.includes("@") && (
          <div className="text-xs text-ink-600 bg-ink-50 border border-ink-200 rounded-lg p-3">
            ℹ️ Doménu <strong>{imapUsername.split("@")[1]}</strong> neznám —
            zadej IMAP host ručně. Heslo bývá to samé, kterým se přihlašuješ
            do webmailu (pokud máš 2FA, většina providerů vyžaduje vytvořit
            zvláštní app password).
          </div>
        )}

        <Field label={isEdit ? "Heslo (vynech pro zachování)" : (provider?.requiresAppPassword === "always" ? "App password" : "Heslo / App password")}>
          <input
            type="password"
            value={imapPassword}
            onChange={(e) => setImapPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          />
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

/**
 * Detail karta s instrukcemi jak získat heslo pro daný IMAP provider.
 * Auto-rozbalí pokud `requiresAppPassword === "always"` (Gmail) — tam je
 * krok navíc nutný a user by jinak ztratil čas marným pokusem s běžným heslem.
 */
function ProviderInstructions({ provider }: { provider: ProviderInfo }) {
  const autoOpen = provider.requiresAppPassword === "always";
  const heading = provider.requiresAppPassword === "always"
    ? `📖 ${provider.label} vyžaduje App Password — návod`
    : provider.requiresAppPassword === "when-2fa"
      ? `📖 Návod pro ${provider.label} (s 2FA potřebuješ App Password)`
      : `📖 Návod pro ${provider.label}`;

  return (
    <details
      className="bg-blue-50 border border-blue-200 rounded-lg text-sm"
      open={autoOpen}
    >
      <summary className="cursor-pointer px-3 py-2 font-medium text-blue-900 select-none">
        {heading}
      </summary>
      <ol className="px-3 pb-3 space-y-2 text-blue-900 list-decimal list-inside">
        {provider.instructions.map((ins, i) => (
          <li key={i} className="text-xs leading-relaxed">
            <span>{ins.step}</span>
            {ins.link && (
              <span className="ml-1">
                {" → "}
                <a
                  href={ins.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium hover:text-blue-700"
                >
                  {ins.link.label} ↗
                </a>
              </span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

