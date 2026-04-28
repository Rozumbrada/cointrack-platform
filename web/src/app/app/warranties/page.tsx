"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface WarrantyData {
  profileId: string;
  productName: string;
  shop: string;
  purchaseDate: string;       // YYYY-MM-DD
  warrantyYears: number;
  price?: string;
  currency: string;
  note: string;
  receiptImageKey?: string;
}

type WarrantyRow = { syncId: string; data: WarrantyData };

export default function WarrantiesPage() {
  const t = useTranslations("warranties_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const warranties = entitiesByProfile<WarrantyData>("warranties");

  const [editing, setEditing] = useState<WarrantyRow | "new" | null>(null);

  const sorted = useMemo(
    () =>
      [...warranties].sort((a, b) =>
        warrantyEnd(a.data).localeCompare(warrantyEnd(b.data)),
      ),
    [warranties],
  );

  const today = new Date().toISOString().slice(0, 10);

  async function onDelete(row: WarrantyRow) {
    if (!confirm(t("delete_confirm", { name: row.data.productName }))) return;
    const now = new Date().toISOString();
    await withAuth((tk) =>
      sync.push(tk, {
        entities: {
          warranties: [
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
          {t("new_warranty")}
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
          <div className="text-4xl mb-3">🛡️</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_product")}</th>
                <th className="px-6 py-3 font-medium">{t("th_shop")}</th>
                <th className="px-6 py-3 font-medium">{t("th_purchase")}</th>
                <th className="px-6 py-3 font-medium">{t("th_warranty_until")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_price")}</th>
                <th className="px-6 py-3 w-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((w) => {
                const end = warrantyEnd(w.data);
                const daysLeft =
                  end > today
                    ? Math.round(
                        (new Date(end).getTime() - new Date(today).getTime()) /
                          86400_000,
                      )
                    : -1;
                const expired = daysLeft < 0;
                const warnSoon = daysLeft >= 0 && daysLeft <= 30;
                return (
                  <tr key={w.syncId} className={`hover:bg-ink-50/50 group ${expired ? "opacity-50" : ""}`}>
                    <td className="px-6 py-3 font-medium text-ink-900">
                      {w.data.productName}
                    </td>
                    <td className="px-6 py-3 text-ink-600">{w.data.shop || "—"}</td>
                    <td className="px-6 py-3 text-ink-600">{w.data.purchaseDate}</td>
                    <td className="px-6 py-3">
                      <div className="text-ink-900">{end}</div>
                      <div
                        className={`text-xs ${
                          expired
                            ? "text-red-700"
                            : warnSoon
                              ? "text-amber-700"
                              : "text-ink-500"
                        }`}
                      >
                        {expired
                          ? t("expired")
                          : daysLeft === 0
                            ? t("ends_today")
                            : t("days_left", { n: daysLeft })}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                      {w.data.price
                        ? fmt(parseFloat(w.data.price), w.data.currency ?? "CZK", locale)
                        : "—"}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                        <button
                          onClick={() => setEditing(w)}
                          className="text-ink-500 hover:text-ink-700 px-2"
                          title={t("edit")}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => onDelete(w)}
                          className="text-red-500 hover:text-red-700 px-2"
                          title={t("delete")}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <WarrantyEditor
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

function WarrantyEditor({
  initial,
  profileSyncId,
  onClose,
  onSaved,
}: {
  initial: WarrantyRow | null;
  profileSyncId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("warranties_page");
  const [productName, setProductName] = useState(initial?.data.productName ?? "");
  const [shop, setShop] = useState(initial?.data.shop ?? "");
  const [purchaseDate, setPurchaseDate] = useState(
    initial?.data.purchaseDate ?? new Date().toISOString().slice(0, 10),
  );
  const [warrantyYears, setWarrantyYears] = useState(String(initial?.data.warrantyYears ?? 2));
  const [price, setPrice] = useState(initial?.data.price ?? "");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [note, setNote] = useState(initial?.data.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!profileSyncId) {
      setErr(t("no_profile"));
      return;
    }
    if (!productName.trim()) {
      setErr(t("fill_product"));
      return;
    }
    const years = parseInt(warrantyYears, 10);
    if (!years || years <= 0) {
      setErr(t("fill_years"));
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: WarrantyData = {
        profileId: profileSyncId,
        productName: productName.trim(),
        shop: shop.trim(),
        purchaseDate,
        warrantyYears: years,
        price: price ? parseFloat(price.replace(",", ".")).toFixed(2) : undefined,
        currency,
        note,
        receiptImageKey: initial?.data.receiptImageKey,
      };
      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            warranties: [
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
      <Field label={t("field_product")}>
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          autoFocus
          className={inputClass}
        />
      </Field>
      <Field label={t("field_shop")}>
        <input
          type="text"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("field_purchase_date")}>
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("field_warranty_years")}>
          <input
            type="number"
            min="1"
            value={warrantyYears}
            onChange={(e) => setWarrantyYears(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label={t("field_price")}>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
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
      <Field label={t("field_note")}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
    </FormDialog>
  );
}

function warrantyEnd(d: WarrantyData): string {
  if (!d.purchaseDate) return "9999-99-99";
  const end = new Date(d.purchaseDate);
  end.setFullYear(end.getFullYear() + (d.warrantyYears ?? 2));
  return end.toISOString().slice(0, 10);
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
