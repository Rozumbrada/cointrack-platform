"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerCategory, ServerTransaction, toUiTransaction } from "@/lib/sync-types";
import { Pencil, Trash2 } from "lucide-react";

type CategoryRow = { syncId: string; data: ServerCategory };

const PRESET_ICONS = [
  "category", "shopping_cart", "restaurant", "fastfood", "local_cafe",
  "directions_car", "local_gas_station", "flight", "train", "directions_bus",
  "home", "bolt", "water_drop", "wifi", "build",
  "favorite", "fitness_center", "spa", "medical_services", "school",
  "movie", "sports_esports", "music_note", "card_giftcard", "pets",
  "shopping_bag", "checkroom", "devices", "computer", "smartphone",
  "payments", "savings", "account_balance", "receipt_long", "request_quote",
  "work", "business", "volunteer_activism", "celebration", "child_care",
];

const PRESET_COLORS: Array<{ key: string; value: number }> = [
  { key: "color_grey",   value: 0xff9e9e9e },
  { key: "color_red",    value: 0xffef4444 },
  { key: "color_orange", value: 0xfff59e0b },
  { key: "color_yellow", value: 0xffeab308 },
  { key: "color_green",  value: 0xff10b981 },
  { key: "color_teal",   value: 0xff14b8a6 },
  { key: "color_blue",   value: 0xff3b82f6 },
  { key: "color_indigo", value: 0xff6366f1 },
  { key: "color_purple", value: 0xff8b5cf6 },
  { key: "color_pink",   value: 0xffec4899 },
];

export default function CategoriesPage() {
  const t = useTranslations("categories_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, diagnose, profileSyncId, reload } = useSyncData();
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const catDiag = diagnose("categories");

  const [editing, setEditing] = useState<{ row: CategoryRow | null; type: "INCOME" | "EXPENSE" } | null>(null);

  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  /**
   * Pro každou kategorii spočítáme zvlášť příjmy a výdaje za aktuální měsíc.
   * Stejná kategorie může mít jak income tak expense transakce — neřídíme se
   * podle category.type, ale podle směru konkrétní transakce.
   */
  const sums = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const m = new Map<
      string,
      { incomeCount: number; incomeAmount: number; expenseCount: number; expenseAmount: number }
    >();
    for (const tx of uiTxs) {
      if (tx.type !== "EXPENSE" && tx.type !== "INCOME") continue;
      if (!tx.date?.startsWith(monthKey)) continue;
      const cid = tx.categorySyncId;
      if (!cid) continue;
      const prev = m.get(cid) ?? {
        incomeCount: 0, incomeAmount: 0, expenseCount: 0, expenseAmount: 0,
      };
      if (tx.type === "INCOME") {
        prev.incomeCount += 1;
        prev.incomeAmount += tx.amount;
      } else {
        prev.expenseCount += 1;
        prev.expenseAmount += tx.amount;
      }
      m.set(cid, prev);
    }
    return m;
  }, [uiTxs]);

  const sortedCategories = useMemo(
    () => [...categoryEntities].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categoryEntities],
  );

  async function onDelete(row: CategoryRow) {
    if (!confirm(t("delete_confirm", { name: row.data.name }))) return;
    const now = new Date().toISOString();
    try {
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            categories: [
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
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setEditing({ row: null, type: "EXPENSE" })}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("new_category")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : categoryEntities.length === 0 ? (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
            <div className="text-4xl mb-3">📂</div>
            <div className="font-medium text-ink-900">
              {catDiag.total === 0 ? t("empty_no_cats") : t("empty_no_cats_for_profile")}
            </div>
            <p className="text-sm text-ink-600 mt-2">
              {catDiag.total === 0 ? t("empty_create_hint") : t("empty_filter_hint", { total: catDiag.total })}
            </p>
          </div>
          {catDiag.total > 0 && catDiag.matched === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
              <div className="font-medium">{t("diag_title")}</div>
              {profileSyncId && (
                <div className="font-mono break-all">{t("diag_active_profile")} {profileSyncId}</div>
              )}
              {catDiag.otherProfiles.size > 0 && (
                <div className="font-mono break-all">
                  {t("diag_other_profiles")} {Array.from(catDiag.otherProfiles).slice(0, 5).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <CategoryList
          items={sortedCategories}
          sums={sums}
          onEdit={(row) =>
            setEditing({
              row,
              type: row.data.type?.toUpperCase() === "INCOME" ? "INCOME" : "EXPENSE",
            })
          }
          onDelete={onDelete}
        />
      )}

      {editing && (
        <CategoryEditor
          initial={editing.row}
          type={editing.type}
          profileSyncId={profileSyncId}
          maxPosition={Math.max(0, ...categoryEntities.map((c) => c.data.position ?? 0))}
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

type CategoryStat = {
  incomeCount: number;
  incomeAmount: number;
  expenseCount: number;
  expenseAmount: number;
};

function CategoryList({
  items,
  sums,
  onEdit,
  onDelete,
}: {
  items: CategoryRow[];
  sums: Map<string, CategoryStat>;
  onEdit: (row: CategoryRow) => void;
  onDelete: (row: CategoryRow) => void;
}) {
  const t = useTranslations("categories_page");
  const locale = useLocale();
  return (
    <section className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
      <ul className="divide-y divide-ink-100">
        {items.map((c) => {
          const s = sums.get(c.syncId);
          const totalCount = (s?.incomeCount ?? 0) + (s?.expenseCount ?? 0);
          const primaryType = c.data.type?.toUpperCase();
          return (
            <li key={c.syncId} className="px-5 py-3 flex items-center gap-3 group">
              <div
                className="w-9 h-9 rounded-full grid place-items-center shrink-0"
                style={{ backgroundColor: colorFromInt(c.data.color) }}
              >
                <CategoryIcon name={c.data.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink-900 truncate flex items-center gap-2">
                  {c.data.name}
                  {primaryType && (
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        primaryType === "INCOME"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {primaryType === "INCOME" ? t("primary_income") : t("primary_expense")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-500 mt-0.5">
                  {totalCount === 0 ? t("no_tx_this_month") : t("tx_this_month_count", { count: totalCount })}
                </div>
              </div>
              {s && (s.incomeCount > 0 || s.expenseCount > 0) && (
                <div className="text-right text-xs space-y-0.5">
                  {s.incomeCount > 0 && (
                    <div className="text-emerald-700 font-medium tabular-nums">
                      +{fmt(s.incomeAmount, "CZK", locale)}
                    </div>
                  )}
                  {s.expenseCount > 0 && (
                    <div className="text-red-700 font-medium tabular-nums">
                      −{fmt(s.expenseAmount, "CZK", locale)}
                    </div>
                  )}
                </div>
              )}
              {/* Inline edit + delete — vždy viditelné, ne hover-only.
                  Sjednoceno s transactions list (lucide-react ikonky). */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  className="p-2 rounded-lg text-ink-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                  title={t("edit")}
                  aria-label={t("edit")}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  className="p-2 rounded-lg text-ink-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                  title={t("delete")}
                  aria-label={t("delete")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryEditor({
  initial,
  type,
  profileSyncId,
  maxPosition,
  onClose,
  onSaved,
}: {
  initial: CategoryRow | null;
  type: "INCOME" | "EXPENSE";
  profileSyncId: string | null;
  maxPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("categories_page");
  const [name, setName] = useState(initial?.data.name ?? "");
  const [icon, setIcon] = useState(initial?.data.icon ?? "category");
  const [color, setColor] = useState<number>(initial?.data.color ?? PRESET_COLORS[0].value);
  const [primaryType, setPrimaryType] = useState<"EXPENSE" | "INCOME">(
    initial?.data.type?.toUpperCase() === "INCOME" ? "INCOME" : (type ?? "EXPENSE"),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    if (!profileSyncId) {
      setErr(t("no_profile"));
      return;
    }
    if (!name.trim()) {
      setErr(t("fill_name"));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const syncId = initial?.syncId ?? crypto.randomUUID();
      const data: ServerCategory & Record<string, unknown> = {
        profileId: profileSyncId,
        name: name.trim(),
        type: primaryType.toLowerCase(),
        color,
        icon,
        position: initial?.data.position ?? maxPosition + 1,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            categories: [
              {
                syncId,
                updatedAt: now,
                clientVersion: (initial ? 1 : 1),
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
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">
            {initial ? t("editor_edit_title") : t("editor_new_title")}
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
          {(["EXPENSE", "INCOME"] as const).map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setPrimaryType(pt)}
              className={`flex-1 py-2 ${
                primaryType === pt
                  ? pt === "EXPENSE"
                    ? "bg-red-50 text-red-700 font-medium"
                    : "bg-emerald-50 text-emerald-700 font-medium"
                  : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {pt === "EXPENSE" ? t("tab_expense") : t("tab_income")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: colorFromInt(color) }}
          >
            <CategoryIcon name={icon} large />
          </div>
          <input
            type="text"
            placeholder={t("name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            autoFocus
          />
        </div>

        <div>
          <div className="text-xs font-medium text-ink-600 mb-2">{t("color")}</div>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                title={t(c.key)}
                className={`w-8 h-8 rounded-full border-2 ${color === c.value ? "border-ink-900" : "border-transparent"}`}
                style={{ backgroundColor: colorFromInt(c.value, 0.6) }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-ink-600 mb-2">{t("icon")}</div>
          <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto p-1 border border-ink-200 rounded-lg">
            {PRESET_ICONS.map((name) => (
              <button
                key={name}
                onClick={() => setIcon(name)}
                title={name}
                className={`aspect-square grid place-items-center rounded hover:bg-ink-100 ${icon === name ? "bg-brand-50 ring-2 ring-brand-500" : ""}`}
              >
                <CategoryIcon name={name} />
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-ink-300 text-sm text-ink-700 hover:bg-ink-50"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryIcon({ name, large = false }: { name?: string; large?: boolean }) {
  const cls = large ? "text-2xl" : "text-lg";
  if (!name) return <span className={cls}>📂</span>;
  // Pokud to vypadá jako Material Icons identifier (obsahuje jen [a-z_0-9]),
  // renderuj přes Material Icons font; jinak nech být (emoji apod.).
  const isMaterial = /^[a-z0-9_]+$/.test(name);
  if (isMaterial) {
    return (
      <span className={`material-icons text-ink-700 ${large ? "text-[28px]" : "text-[20px]"}`}>
        {name}
      </span>
    );
  }
  return <span className={cls}>{name}</span>;
}

function colorFromInt(c?: number, alpha = 0.2): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
