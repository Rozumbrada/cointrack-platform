"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface OrganizationDto {
  id: string;
  name: string;
  planTier: string;
  memberCount: number;
  myRole: string;
  type: string;
  currency: string;
}

interface OrganizationListResponse {
  organizations: OrganizationDto[];
}

interface MessageResponse { message: string }

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrganizationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const res = await withAuth((t) =>
        api<OrganizationListResponse>("/api/v1/org", { token: t }),
      );
      setOrgs(res.organizations);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function rename(orgId: string, currentName: string) {
    const newName = prompt("Nový název:", currentName);
    if (!newName || newName.trim() === "" || newName === currentName) return;
    try {
      await withAuth((t) =>
        api<MessageResponse>(`/api/v1/org/${orgId}`, {
          method: "PATCH",
          body: { name: newName.trim() },
          token: t,
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteOrg(orgId: string, name: string) {
    const ok = confirm(
      `Opravdu smazat organizaci "${name}"?\n\n` +
      `• Profily v ní zůstanou (převedou se na osobní vlastníků).\n` +
      `• Všechna pozvánky budou odvolány.\n` +
      `• Členové ztratí přístup ke sdíleným datům.\n\n` +
      `Akce je nevratná.`,
    );
    if (!ok) return;
    try {
      await withAuth((t) =>
        api<MessageResponse>(`/api/v1/org/${orgId}`, { method: "DELETE", token: t }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const b2b = orgs.filter((o) => o.type === "B2B");
  const groups = orgs.filter((o) => o.type === "GROUP");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Organizace a skupiny</h1>
          <p className="text-sm text-ink-600 mt-1">
            B2B firmy (sdílené účetnictví) a skupinové profily (dělení výdajů).
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          + Nová
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : orgs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="font-medium text-ink-900">Žádné organizace</div>
          <p className="text-sm text-ink-600 mt-2">
            Vytvoř firmu nebo skupinu v mobilní aplikaci.
          </p>
        </div>
      ) : (
        <>
          <OrgSection title="Firmy (B2B)" icon="🏢" orgs={b2b} onRename={rename} onDelete={deleteOrg} />
          <OrgSection title="Skupiny" icon="👥" orgs={groups} onRename={rename} onDelete={deleteOrg} />
        </>
      )}

      {creating && (
        <CreateOrgDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateOrgDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"B2B" | "GROUP">("B2B");
  const [currency, setCurrency] = useState("CZK");
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setErr("Vyplň název.");
    setSaving(true);
    setErr(null);
    try {
      const inviteEmails = emails
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await withAuth((t) =>
        api(`/api/v1/org`, {
          method: "POST",
          body: { name: name.trim(), type, currency, inviteEmails },
          token: t,
        }),
      );
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title="Nová organizace / skupina"
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel="Vytvořit"
    >
      <div className="flex rounded-lg border border-ink-300 overflow-hidden">
        <button
          type="button"
          onClick={() => setType("B2B")}
          className={`flex-1 py-2 text-sm ${type === "B2B" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"}`}
        >
          🏢 Firma (B2B)
        </button>
        <button
          type="button"
          onClick={() => setType("GROUP")}
          className={`flex-1 py-2 text-sm ${type === "GROUP" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"}`}
        >
          👥 Skupina
        </button>
      </div>
      <Field label="Název">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={inputClass}
          placeholder={type === "B2B" ? "Acme s.r.o." : "Cestování s rodinou"}
        />
      </Field>
      <Field label="Měna">
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          {["CZK", "EUR", "USD"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Pozvat e-maily (volitelné, čárkou)">
        <input
          type="text"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="kolega@firma.cz, parak@gmail.com"
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-ink-500">
        {type === "B2B"
          ? "B2B firma sdílí účetnictví mezi členy. Můžeš ji použít pro účtenky a faktury společnosti."
          : "Skupinový profil pro společné výdaje (např. dovolená) — položky se rozdělí mezi členy."}
      </p>
    </FormDialog>
  );
}

function OrgSection({
  title,
  icon,
  orgs,
  onRename,
  onDelete,
}: {
  title: string;
  icon: string;
  orgs: OrganizationDto[];
  onRename: (orgId: string, name: string) => void;
  onDelete: (orgId: string, name: string) => void;
}) {
  if (orgs.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-ink-200">
      <div className="px-6 py-3 border-b border-ink-200">
        <h2 className="font-semibold text-ink-900">{title}</h2>
      </div>
      <ul className="divide-y divide-ink-100">
        {orgs.map((o) => {
          const isOwner = o.myRole === "owner";
          return (
            <li key={o.id} className="px-6 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-ink-100 grid place-items-center text-xl">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink-900 truncate">
                  {o.name}
                </div>
                <div className="text-xs text-ink-500 flex items-center gap-2">
                  <span>{o.memberCount} členů</span>
                  <span>·</span>
                  <span>{o.currency}</span>
                  <span>·</span>
                  <span className="text-[10px] uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
                    {labelRole(o.myRole)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isOwner && (
                  <>
                    <button
                      onClick={() => onRename(o.id, o.name)}
                      className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"
                      title="Přejmenovat"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDelete(o.id, o.name)}
                      className="w-8 h-8 grid place-items-center rounded-lg hover:bg-red-50 text-red-500"
                      title="Smazat organizaci"
                    >
                      🗑
                    </button>
                  </>
                )}
                <span className="text-[10px] uppercase text-ink-500 ml-2">{o.planTier}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function labelRole(r: string): string {
  switch (r) {
    case "owner": return "vlastník";
    case "admin": return "admin";
    case "member": return "člen";
    default: return r;
  }
}
