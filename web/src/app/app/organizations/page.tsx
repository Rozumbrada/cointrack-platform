"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

interface InviteDto {
  id: string;
  email: string;
  role: string;
  invitedByEmail?: string;
  expiresAt: string;
  createdAt: string;
}

export default function OrganizationsPage() {
  const t = useTranslations("organizations_page");
  const [orgs, setOrgs] = useState<OrganizationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviteOrg, setInviteOrg] = useState<OrganizationDto | null>(null);

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
    const newName = prompt(t("rename_prompt"), currentName);
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
    const ok = confirm(t("delete_confirm", { name }));
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
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("new")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : orgs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <>
          <OrgSection title={t("section_b2b")} icon="🏢" orgs={b2b}
            onRename={rename} onDelete={deleteOrg} onInvite={setInviteOrg} />
          <OrgSection title={t("section_groups")} icon="👥" orgs={groups}
            onRename={rename} onDelete={deleteOrg} onInvite={setInviteOrg} />
        </>
      )}

      {inviteOrg && (
        <InviteMemberDialog
          org={inviteOrg}
          onClose={() => setInviteOrg(null)}
          onInvited={async () => { setInviteOrg(null); await load(); }}
        />
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
  const t = useTranslations("organizations_page");
  const [name, setName] = useState("");
  const [type, setType] = useState<"B2B" | "GROUP">("B2B");
  const [currency, setCurrency] = useState("CZK");
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setErr(t("fill_name"));
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
      title={t("create_title")}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel={t("create_btn")}
    >
      <div className="flex rounded-lg border border-ink-300 overflow-hidden">
        <button
          type="button"
          onClick={() => setType("B2B")}
          className={`flex-1 py-2 text-sm ${type === "B2B" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"}`}
        >
          {t("type_b2b")}
        </button>
        <button
          type="button"
          onClick={() => setType("GROUP")}
          className={`flex-1 py-2 text-sm ${type === "GROUP" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"}`}
        >
          {t("type_group")}
        </button>
      </div>
      <Field label={t("field_name")}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={inputClass}
          placeholder={type === "B2B" ? t("name_b2b_placeholder") : t("name_group_placeholder")}
        />
      </Field>
      <Field label={t("field_currency")}>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          {["CZK", "EUR", "USD"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label={t("field_invite_emails")}>
        <input
          type="text"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder={t("emails_placeholder")}
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-ink-500">
        {type === "B2B" ? t("create_b2b_desc") : t("create_group_desc")}
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
  onInvite,
}: {
  title: string;
  icon: string;
  orgs: OrganizationDto[];
  onRename: (orgId: string, name: string) => void;
  onDelete: (orgId: string, name: string) => void;
  onInvite: (org: OrganizationDto) => void;
}) {
  const t = useTranslations("organizations_page");
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
                  <span>{t("members_count", { n: o.memberCount })}</span>
                  <span>·</span>
                  <span>{o.currency}</span>
                  <span>·</span>
                  <span className="text-[10px] uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
                    {labelRole(o.myRole, t)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {(isOwner || o.myRole === "admin") && (
                  <button
                    onClick={() => onInvite(o)}
                    className="h-8 px-3 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-medium"
                    title={t("invite_title_tooltip")}
                  >
                    {t("invite_btn")}
                  </button>
                )}
                {isOwner && (
                  <>
                    <button
                      onClick={() => onRename(o.id, o.name)}
                      className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"
                      title={t("rename_title_tooltip")}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDelete(o.id, o.name)}
                      className="w-8 h-8 grid place-items-center rounded-lg hover:bg-red-50 text-red-500"
                      title={t("delete_title_tooltip")}
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

function labelRole(r: string, t: (key: string) => string): string {
  switch (r) {
    case "owner": return t("role_owner");
    case "admin": return t("role_admin");
    case "accountant": return t("role_accountant");
    case "member": return t("role_member");
    default: return r;
  }
}

function InviteMemberDialog({
  org,
  onClose,
  onInvited,
}: {
  org: OrganizationDto;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const t = useTranslations("organizations_page");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "accountant">("member");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!email.trim() || !email.includes("@")) return setErr(t("fill_email"));
    setSaving(true);
    setErr(null);
    try {
      await withAuth((t) =>
        api<InviteDto>(`/api/v1/org/${org.id}/invites`, {
          method: "POST",
          body: { email: email.trim().toLowerCase(), role },
          token: t,
        }),
      );
      await onInvited();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={t("invite_dialog_title", { name: org.name })}
      onClose={onClose}
      onSave={send}
      saving={saving}
      error={err}
      saveLabel={t("invite_send_btn")}
    >
      <Field label={t("field_email")}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          className={inputClass}
          placeholder={t("email_placeholder")}
        />
      </Field>
      <Field label={t("field_role")}>
        <div className="flex gap-2 flex-wrap">
          {(["member", "admin", "accountant"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                role === r
                  ? "bg-brand-50 border-brand-300 text-brand-700"
                  : "bg-white border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              {r === "member" ? t("role_member_btn") : r === "admin" ? t("role_admin_btn") : t("role_accountant_btn")}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-xs text-ink-500 leading-relaxed">
        {role === "admin"
          ? t("role_admin_desc")
          : role === "accountant"
          ? t("role_accountant_desc")
          : t("role_member_desc")}
      </p>
    </FormDialog>
  );
}
