"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { idoklad, IDokladInvoiceItemDto } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

export default function NewIDokladInvoicePage() {
  const router = useRouter();
  const t = useTranslations("idoklad_new_invoice");
  const profileSyncId = getCurrentProfileSyncId();

  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [partnerName, setPartnerName] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerStreet, setPartnerStreet] = useState("");
  const [partnerCity, setPartnerCity] = useState("");
  const [partnerPostalCode, setPartnerPostalCode] = useState("");
  const [partnerIco, setPartnerIco] = useState("");
  const [partnerDic, setPartnerDic] = useState("");
  const [dateOfIssue, setDateOfIssue] = useState(today);
  const [dateOfMaturity, setDateOfMaturity] = useState(due);
  const [variableSymbol, setVariableSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [currencyCode, setCurrencyCode] = useState("CZK");
  const [items, setItems] = useState<IDokladInvoiceItemDto[]>([
    { name: "", quantity: 1, unitPrice: 0, unitName: "ks" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(i: number, patch: Partial<IDokladInvoiceItemDto>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { name: "", quantity: 1, unitPrice: 0, unitName: "ks" }]);
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const total = items.reduce((s, it) => s + (it.unitPrice ?? 0) * (it.quantity ?? 1), 0);

  async function onSubmit() {
    if (!profileSyncId) {
      setError(t("select_profile_first"));
      return;
    }
    if (!partnerName.trim()) {
      setError(t("fill_partner_name"));
      return;
    }
    if (items.length === 0 || items.some((it) => !it.name.trim() || it.unitPrice <= 0)) {
      setError(t("fill_items"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await withAuth((t) =>
        idoklad.createInvoice(t, {
          profileId: profileSyncId,
          partnerName: partnerName.trim(),
          partnerEmail: partnerEmail.trim() || undefined,
          partnerStreet: partnerStreet.trim() || undefined,
          partnerCity: partnerCity.trim() || undefined,
          partnerPostalCode: partnerPostalCode.trim() || undefined,
          partnerIco: partnerIco.trim() || undefined,
          partnerDic: partnerDic.trim() || undefined,
          dateOfIssue,
          dateOfMaturity,
          variableSymbol: variableSymbol.trim() || undefined,
          description: description.trim() || undefined,
          note: note.trim() || undefined,
          currencyCode,
          items,
        }),
      );
      router.push(`/app/invoices/${res.cointrackInvoiceSyncId}`);
    } catch (e) {
      setError(t("create_failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <Link href="/app/idoklad" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back")}
        </Link>
      </div>

      <p className="text-sm text-ink-600">{t("intro")}</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{error}</div>
      )}

      <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
        <h2 className="font-semibold text-ink-900">{t("section_partner")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t("field_partner_name")} value={partnerName} onChange={setPartnerName} />
          <Field label={t("field_email")} value={partnerEmail} onChange={setPartnerEmail} />
          <Field label={t("field_street")} value={partnerStreet} onChange={setPartnerStreet} />
          <Field label={t("field_city")} value={partnerCity} onChange={setPartnerCity} />
          <Field label={t("field_zip")} value={partnerPostalCode} onChange={setPartnerPostalCode} />
          <Field label={t("field_ico")} value={partnerIco} onChange={setPartnerIco} />
          <Field label={t("field_dic")} value={partnerDic} onChange={setPartnerDic} />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
        <h2 className="font-semibold text-ink-900">{t("section_dates")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t("field_issue_date")} value={dateOfIssue} onChange={setDateOfIssue} type="date" />
          <Field label={t("field_due_date")} value={dateOfMaturity} onChange={setDateOfMaturity} type="date" />
          <Field label={t("field_vs")} value={variableSymbol} onChange={setVariableSymbol} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t("field_description")} value={description} onChange={setDescription} />
          <label className="space-y-1">
            <div className="text-xs text-ink-600">{t("field_currency")}</div>
            <select
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            >
              <option value="CZK">CZK</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>
        <Field label={t("field_note")} value={note} onChange={setNote} />
      </section>

      <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">{t("section_items")}</h2>
          <button onClick={addItem} className="text-sm text-brand-600 hover:underline">
            {t("add_item")}
          </button>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5">
                <Field label={i === 0 ? t("field_item_name") : ""} value={it.name} onChange={(v) => updateItem(i, { name: v })} />
              </div>
              <div className="col-span-2">
                <Field label={i === 0 ? t("field_quantity") : ""} type="number" value={String(it.quantity ?? 1)} onChange={(v) => updateItem(i, { quantity: parseFloat(v) || 0 })} />
              </div>
              <div className="col-span-2">
                <Field label={i === 0 ? t("field_unit") : ""} value={it.unitName ?? "ks"} onChange={(v) => updateItem(i, { unitName: v })} />
              </div>
              <div className="col-span-2">
                <Field label={i === 0 ? t("field_unit_price") : ""} type="number" value={String(it.unitPrice ?? 0)} onChange={(v) => updateItem(i, { unitPrice: parseFloat(v) || 0 })} />
              </div>
              <div className="col-span-1">
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(i)}
                    className="h-10 w-full rounded-lg border border-ink-300 bg-white hover:bg-red-50 text-red-600 text-sm"
                    aria-label={t("remove_item")}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-3 border-t border-ink-100">
          <div className="text-right">
            <div className="text-xs text-ink-500 uppercase">{t("total")}</div>
            <div className="text-2xl font-semibold text-ink-900 tabular-nums">
              {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link
          href="/app/idoklad"
          className="h-10 px-4 inline-flex items-center rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
        >
          {t("cancel")}
        </Link>
        <button
          onClick={onSubmit}
          disabled={busy}
          className="h-10 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {busy ? t("creating") : t("create")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 block">
      {label && <div className="text-xs text-ink-600">{label}</div>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}
