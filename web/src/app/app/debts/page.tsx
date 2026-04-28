"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface DebtData {
  profileId: string;
  personName: string;
  amount: string;
  currency: string;
  /** "LENT" = dluží mně, "BORROWED" = já dlužím */
  type: string;
  description: string;
  dueDate?: string;
  isPaid: boolean;
  createdDate: string;
}

type DebtRow = { syncId: string; data: DebtData };

export default function DebtsPage() {
  const t = useTranslations("debts_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const debts = entitiesByProfile<DebtData>("debts");
  const [editing, setEditing] = useState<DebtRow | "new" | null>(null);

  const active = useMemo(() => debts.filter((d) => !d.data.isPaid), [debts]);
  const paid = useMemo(() => debts.filter((d) => d.data.isPaid), [debts]);

  const totals = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of active) {
      if (d.data.currency !== "CZK") continue;
      const amt = parseFloat(d.data.amount) || 0;
      if (d.data.type?.toUpperCase() === "LENT") owedToMe += amt;
      else iOwe += amt;
    }
    return { owedToMe, iOwe };
  }, [active]);

  async function onDelete(row: DebtRow) {
    if (!confirm(t("delete_confirm", { name: row.data.personName }))) return;
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          debts: [
            {
              syncId: row.syncId,
              updatedAt: now,
              deletedAt: now,
              clientVersion: 1,
              data: row.data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  async function togglePaid(row: DebtRow) {
    const now = new Date().toISOString();
    const data: DebtData = { ...row.data, isPaid: !row.data.isPaid };
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          debts: [
            {
              syncId: row.syncId,
              updatedAt: now,
              clientVersion: 1,
              data: data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("new_debt")}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
            {t("summary_owed_to_me")}
          </div>
          <div className="text-2xl font-semibold text-emerald-700">
            {fmt(totals.owedToMe, "CZK", locale)}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
            {t("summary_i_owe")}
          </div>
          <div className="text-2xl font-semibold text-red-700">
            {fmt(totals.iOwe, "CZK", locale)}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {t("error_prefix")} {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : debts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🤝</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <>
          <Section
            title={t("section_active")}
            items={active}
            onEdit={(d) => setEditing(d)}
            onDelete={onDelete}
            onTogglePaid={togglePaid}
          />
          {paid.length > 0 && (
            <Section
              title={t("section_resolved")}
              items={paid}
              dim
              onEdit={(d) => setEditing(d)}
              onDelete={onDelete}
              onTogglePaid={togglePaid}
            />
          )}
        </>
      )}

      {editing && (
        <DebtEditor
          initial={editing === "new" ? null : editing}
          profileSyncId={profileSyncId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  items,
  dim = false,
  onEdit,
  onDelete,
  onTogglePaid,
}: {
  title: string;
  items: DebtRow[];
  dim?: boolean;
  onEdit: (row: DebtRow) => void;
  onDelete: (row: DebtRow) => void;
  onTogglePaid: (row: DebtRow) => void;
}) {
  const t = useTranslations("debts_page");
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-ink-200">
      <div className="px-6 py-3 border-b border-ink-200">
        <h2 className="font-semibold text-ink-900">{title}</h2>
      </div>
      <ul className="divide-y divide-ink-100">
        {items.map((d) => {
          const lent = d.data.type?.toUpperCase() === "LENT";
          return (
            <li
              key={d.syncId}
              className={`px-6 py-3 flex items-center gap-3 group ${dim ? "opacity-60" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink-900 truncate">
                  {d.data.personName}
                </div>
                <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
                  <span>{lent ? t("owes_me") : t("i_owe")}</span>
                  {d.data.dueDate && <span>· {t("due_prefix")} {d.data.dueDate}</span>}
                  {d.data.isPaid && <span className="text-emerald-700">· {t("resolved_dot")}</span>}
                </div>
                {d.data.description && (
                  <div className="text-xs text-ink-500 mt-0.5 truncate">{d.data.description}</div>
                )}
              </div>
              <div className={`text-sm font-semibold tabular-nums ${lent ? "text-emerald-700" : "text-red-700"}`}>
                {fmt(parseFloat(d.data.amount) || 0, d.data.currency, locale)}
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                <button
                  onClick={() => onTogglePaid(d)}
                  title={d.data.isPaid ? t("mark_active") : t("mark_resolved")}
                  className="text-emerald-600 hover:text-emerald-800 px-1"
                >
                  {d.data.isPaid ? "↩︎" : "✓"}
                </button>
                <button onClick={() => onEdit(d)} className="text-ink-500 hover:text-ink-700 px-1" title={t("edit")}>
                  ✏️
                </button>
                <button onClick={() => onDelete(d)} className="text-red-500 hover:text-red-700 px-1" title={t("delete")}>
                  🗑
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DebtEditor({
  initial,
  profileSyncId,
  onClose,
  onSaved,
}: {
  initial: DebtRow | null;
  profileSyncId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("debts_page");
  const [personName, setPersonName] = useState(initial?.data.personName ?? "");
  const [amount, setAmount] = useState(initial?.data.amount ?? "");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [type, setType] = useState<"LENT" | "BORROWED">(
    initial?.data.type?.toUpperCase() === "BORROWED" ? "BORROWED" : "LENT",
  );
  const [description, setDescription] = useState(initial?.data.description ?? "");
  const [dueDate, setDueDate] = useState(initial?.data.dueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!profileSyncId) return setErr(t("no_profile"));
    if (!personName.trim()) return setErr(t("fill_name"));
    const amt = parseFloat(amount.replace(",", "."));
    if (!amt || amt <= 0) return setErr(t("fill_amount"));

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: DebtData = {
        profileId: profileSyncId,
        personName: personName.trim(),
        amount: amt.toFixed(2),
        currency,
        type,
        description,
        dueDate: dueDate || undefined,
        isPaid: initial?.data.isPaid ?? false,
        createdDate: initial?.data.createdDate ?? now.slice(0, 10),
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            debts: [
              {
                syncId: initial?.syncId ?? crypto.randomUUID(),
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? t("editor_edit") : t("editor_new")}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
    >
      <div className="flex rounded-lg border border-ink-300 overflow-hidden">
        <button
          type="button"
          onClick={() => setType("LENT")}
          className={`flex-1 py-2 text-sm ${type === "LENT" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-ink-700"}`}
        >
          {t("tab_lent")}
        </button>
        <button
          type="button"
          onClick={() => setType("BORROWED")}
          className={`flex-1 py-2 text-sm ${type === "BORROWED" ? "bg-red-50 text-red-700 font-medium" : "text-ink-700"}`}
        >
          {t("tab_borrowed")}
        </button>
      </div>
      <Field label={t("field_person")}>
        <input
          type="text"
          value={personName}
          onChange={(e) => setPersonName(e.target.value)}
          autoFocus
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label={t("field_amount")}>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label={t("field_currency")}>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("field_due_date")}>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label={t("field_description")}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
    </FormDialog>
  );
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
