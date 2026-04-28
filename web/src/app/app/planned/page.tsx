"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount, ServerCategory } from "@/lib/sync-types";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface PlannedData {
  profileId: string;
  accountId: string;
  categoryId?: string;
  name: string;
  amount: string;
  currency: string;
  /** "INCOME" | "EXPENSE" */
  type: string;
  /** "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "ONCE" */
  period: string;
  /** YYYY-MM-DD */
  nextDate: string;
  note: string;
  isActive: boolean;
}

type PlannedRow = { syncId: string; data: PlannedData };

export default function PlannedPage() {
  const t = useTranslations("planned_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const planned = entitiesByProfile<PlannedData>("planned_payments");
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const categories = entitiesByProfile<ServerCategory>("categories");
  const [editing, setEditing] = useState<PlannedRow | "new" | null>(null);

  const sorted = useMemo(
    () => [...planned].sort((a, b) => (a.data.nextDate ?? "").localeCompare(b.data.nextDate ?? "")),
    [planned],
  );

  async function onDelete(row: PlannedRow) {
    if (!confirm(t("delete_confirm", { name: row.data.name }))) return;
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          planned_payments: [
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
          {t("new_planned")}
        </button>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {t("error_prefix")} {error}
        </div>
      )}
      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {sorted.map((p) => {
              const isIncome = p.data.type?.toUpperCase() === "INCOME";
              const inactive = p.data.isActive === false;
              const amt = parseFloat(p.data.amount) || 0;
              return (
                <li key={p.syncId} className="px-6 py-4 flex items-center gap-3 group">
                  <div
                    className={`w-8 h-8 rounded-full grid place-items-center text-sm ${
                      isIncome ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {isIncome ? "↓" : "↑"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900 truncate flex items-center gap-2">
                      {p.data.name}
                      {inactive && (
                        <span className="text-[10px] uppercase tracking-wide bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                          {t("paused")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500">
                      {t("next_date", { date: p.data.nextDate })} · {periodLabel(p.data.period, t)}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums ${isIncome ? "text-emerald-700" : "text-ink-900"}`}>
                    {isIncome ? "+" : "−"}
                    {fmt(amt, p.data.currency, locale)}
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1 ml-2">
                    <button onClick={() => setEditing(p)} className="text-ink-500 hover:text-ink-700 px-1" title={t("edit")}>
                      ✏️
                    </button>
                    <button onClick={() => onDelete(p)} className="text-red-500 hover:text-red-700 px-1" title={t("delete")}>
                      🗑
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing && (
        <PlannedEditor
          initial={editing === "new" ? null : editing}
          profileSyncId={profileSyncId}
          accounts={accounts}
          categories={categories}
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

function PlannedEditor({
  initial,
  profileSyncId,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  initial: PlannedRow | null;
  profileSyncId: string | null;
  accounts: Array<{ syncId: string; data: ServerAccount }>;
  categories: Array<{ syncId: string; data: ServerCategory }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planned_page");
  const [type, setType] = useState<"EXPENSE" | "INCOME">(
    initial?.data.type?.toUpperCase() === "INCOME" ? "INCOME" : "EXPENSE",
  );
  const [name, setName] = useState(initial?.data.name ?? "");
  const [amount, setAmount] = useState(initial?.data.amount ?? "");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [accountId, setAccountId] = useState(initial?.data.accountId ?? accounts[0]?.syncId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.data.categoryId ?? "");
  const [period, setPeriod] = useState(initial?.data.period?.toUpperCase() ?? "MONTHLY");
  const [nextDate, setNextDate] = useState(
    initial?.data.nextDate ?? new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(initial?.data.note ?? "");
  const [active, setActive] = useState(initial?.data.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filteredCats = useMemo(
    () =>
      [...categories]
        .filter((c) => c.data.type?.toUpperCase() === type)
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categories, type],
  );

  async function save() {
    if (!profileSyncId) return setErr(t("no_profile"));
    if (!name.trim()) return setErr(t("fill_name"));
    if (!accountId) return setErr(t("fill_account"));
    const amt = parseFloat(amount.replace(",", "."));
    if (!amt || amt <= 0) return setErr(t("fill_amount"));
    if (!nextDate) return setErr(t("fill_date"));

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: PlannedData = {
        profileId: profileSyncId,
        accountId,
        categoryId: categoryId || undefined,
        name: name.trim(),
        amount: amt.toFixed(2),
        currency,
        type,
        period,
        nextDate,
        note,
        isActive: active,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            planned_payments: [
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
        {(["EXPENSE", "INCOME"] as const).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => setType(tk)}
            className={`flex-1 py-2 text-sm ${
              type === tk
                ? tk === "EXPENSE"
                  ? "bg-red-50 text-red-700 font-medium"
                  : "bg-emerald-50 text-emerald-700 font-medium"
                : "text-ink-700"
            }`}
          >
            {tk === "EXPENSE" ? t("tab_expense") : t("tab_income")}
          </button>
        ))}
      </div>
      <Field label={t("field_name")}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} />
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
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("field_account")}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("field_category")}>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          <option value="">{t("no_category")}</option>
          {filteredCats.map((c) => (
            <option key={c.syncId} value={c.syncId}>
              {c.data.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("field_frequency")}>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
            <option value="DAILY">{t("freq_daily")}</option>
            <option value="WEEKLY">{t("freq_weekly")}</option>
            <option value="MONTHLY">{t("freq_monthly")}</option>
            <option value="YEARLY">{t("freq_yearly")}</option>
            <option value="ONCE">{t("freq_once")}</option>
          </select>
        </Field>
        <Field label={t("field_next")}>
          <input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label={t("field_note")}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="w-4 h-4"
        />
        {t("active_label")}
      </label>
    </FormDialog>
  );
}

function periodLabel(p: string | undefined, t: (k: string) => string): string {
  switch (p?.toUpperCase()) {
    case "DAILY": return t("freq_short_daily");
    case "WEEKLY": return t("freq_short_weekly");
    case "YEARLY": return t("freq_short_yearly");
    case "ONCE": return t("freq_short_once");
    default: return t("freq_short_monthly");
  }
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
