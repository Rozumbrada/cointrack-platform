"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerCategory, ServerTransaction, computeTxType } from "@/lib/sync-types";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";
import { CategoryIcon, colorFromInt } from "@/components/app/CategoryIcon";

interface BudgetData {
  profileId: string;
  categoryId?: string;
  name: string;
  /** server posílá jako string */
  limit: string;
  /** "WEEKLY" | "MONTHLY" | "YEARLY" */
  period: string;
  currency: string;
}

type BudgetRow = { syncId: string; data: BudgetData };

export default function BudgetsPage() {
  const t = useTranslations("budgets_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const budgets = entitiesByProfile<BudgetData>("budgets");
  const cats = entitiesByProfile<ServerCategory>("categories");
  const txs = entitiesByProfile<ServerTransaction>("transactions");
  const [editing, setEditing] = useState<BudgetRow | "new" | null>(null);

  const catMap = useMemo(() => {
    const m = new Map<string, ServerCategory>();
    cats.forEach((c) => m.set(c.syncId, c.data));
    return m;
  }, [cats]);

  /** Spočítá spent pro období podle period typu. */
  const spentPerCatByPeriod = useMemo(() => {
    const now = new Date();
    const dayMs = 86_400_000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const yearStart = `${now.getFullYear()}-01-01`;
    const weekStart = new Date(now.getTime() - 7 * dayMs).toISOString().slice(0, 10);

    const buckets = {
      WEEKLY: new Map<string, number>(),
      MONTHLY: new Map<string, number>(),
      YEARLY: new Map<string, number>(),
    };
    for (const t of txs) {
      if (computeTxType(t.data) !== "EXPENSE") continue;
      const cid = t.data.categoryId;
      if (!cid) continue;
      const amt = Math.abs(parseFloat(t.data.amount) || 0);
      if (t.data.date >= weekStart) buckets.WEEKLY.set(cid, (buckets.WEEKLY.get(cid) ?? 0) + amt);
      if (t.data.date >= monthStart) buckets.MONTHLY.set(cid, (buckets.MONTHLY.get(cid) ?? 0) + amt);
      if (t.data.date >= yearStart) buckets.YEARLY.set(cid, (buckets.YEARLY.get(cid) ?? 0) + amt);
    }
    return buckets;
  }, [txs]);

  async function onDelete(row: BudgetRow) {
    if (!confirm(t("delete_confirm", { name: row.data.name }))) return;
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          budgets: [
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
          {t("new_budget")}
        </button>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{t("error_prefix")} {error}</div>}
      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : budgets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🧮</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {budgets.map((b) => {
            const limit = parseFloat(b.data.limit) || 0;
            const periodKey = (b.data.period?.toUpperCase() ?? "MONTHLY") as
              | "WEEKLY"
              | "MONTHLY"
              | "YEARLY";
            const spent =
              b.data.categoryId != null
                ? (spentPerCatByPeriod[periodKey]?.get(b.data.categoryId) ?? 0)
                : 0;
            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
            const over = limit > 0 && spent > limit;
            const cat = b.data.categoryId ? catMap.get(b.data.categoryId) : undefined;
            return (
              <div key={b.syncId} className="bg-white rounded-2xl border border-ink-200 p-5 group">
                <div className="flex items-start gap-3 mb-2">
                  <div
                    className="w-9 h-9 rounded-full grid place-items-center shrink-0"
                    style={{ backgroundColor: colorFromInt(cat?.color) }}
                  >
                    <CategoryIcon name={cat?.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink-900 truncate">{b.data.name}</div>
                    <div className="text-xs text-ink-500">
                      {periodLabel(b.data.period, t)} · {cat?.name ?? t("all_categories")}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                    <button onClick={() => setEditing(b)} className="text-ink-500 hover:text-ink-700 px-1" title={t("edit")}>
                      ✏️
                    </button>
                    <button onClick={() => onDelete(b)} className="text-red-500 hover:text-red-700 px-1" title={t("delete")}>
                      🗑
                    </button>
                  </div>
                </div>
                <div className="text-sm text-ink-600 mb-2 tabular-nums">
                  {fmt(spent, b.data.currency, locale)} / {fmt(limit, b.data.currency, locale)}
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className={`h-full ${over ? "bg-red-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {over && (
                  <div className="text-xs text-red-700 mt-2">
                    {t("exceeded_by", { amount: fmt(spent - limit, b.data.currency, locale) })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <BudgetEditor
          initial={editing === "new" ? null : editing}
          profileSyncId={profileSyncId}
          categories={cats}
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

function BudgetEditor({
  initial,
  profileSyncId,
  categories,
  onClose,
  onSaved,
}: {
  initial: BudgetRow | null;
  profileSyncId: string | null;
  categories: Array<{ syncId: string; data: ServerCategory }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("budgets_page");
  const [name, setName] = useState(initial?.data.name ?? "");
  const [limit, setLimit] = useState(initial?.data.limit ?? "");
  const [period, setPeriod] = useState(initial?.data.period?.toUpperCase() ?? "MONTHLY");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [categoryId, setCategoryId] = useState(initial?.data.categoryId ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const expenseCats = useMemo(
    () =>
      [...categories]
        .filter((c) => c.data.type?.toUpperCase() === "EXPENSE")
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categories],
  );

  async function save() {
    if (!profileSyncId) return setErr(t("no_profile"));
    if (!name.trim()) return setErr(t("fill_name"));
    const lim = parseFloat(limit.replace(",", "."));
    if (!lim || lim <= 0) return setErr(t("fill_limit"));

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: BudgetData = {
        profileId: profileSyncId,
        categoryId: categoryId || undefined,
        name: name.trim(),
        limit: lim.toFixed(2),
        period,
        currency,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            budgets: [
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
      <Field label={t("field_name")}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} />
      </Field>
      <Field label={t("field_category_optional")}>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">{t("category_all_expenses")}</option>
          {expenseCats.map((c) => (
            <option key={c.syncId} value={c.syncId}>
              {c.data.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label={t("field_limit")}>
            <input
              type="text"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
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
      <Field label={t("field_period")}>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
          <option value="WEEKLY">{t("period_weekly")}</option>
          <option value="MONTHLY">{t("period_monthly")}</option>
          <option value="YEARLY">{t("period_yearly")}</option>
        </select>
      </Field>
    </FormDialog>
  );
}

function periodLabel(p: string | undefined, t: (k: string) => string): string {
  switch (p?.toUpperCase()) {
    case "WEEKLY": return t("period_weekly");
    case "YEARLY": return t("period_yearly");
    default: return t("period_monthly");
  }
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
