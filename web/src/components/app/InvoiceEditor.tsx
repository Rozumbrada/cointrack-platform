"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { sync, SyncEntity } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { FormDialog, Field, inputClass } from "./FormDialog";

export interface InvoiceData {
  profileId: string;
  invoiceNumber?: string | null;
  isExpense: boolean;
  issueDate?: string | null;
  dueDate?: string | null;
  totalWithVat: string;
  totalWithoutVat?: string | null;
  currency: string;
  paymentMethod?: string | null;
  variableSymbol?: string | null;
  bankAccount?: string | null;
  paid: boolean;
  supplierName?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  supplierStreet?: string | null;
  supplierCity?: string | null;
  supplierZip?: string | null;
  customerName?: string | null;
  note?: string | null;
  fileKeys?: string[];
  linkedAccountId?: string | null;
}

export interface InvoiceItemData {
  invoiceId: string;
  name: string;
  quantity: string;
  unitPriceWithVat?: string;
  totalPriceWithVat: string;
  vatRate?: string;
  position: number;
}

type InvoiceRow = { syncId: string; data: InvoiceData };
type ItemRow = { syncId: string; data: InvoiceItemData };

interface DraftItem {
  syncId: string;
  name: string;
  quantity: string;
  totalPriceWithVat: string;
  vatRate: string;
}

export function InvoiceEditor({
  initial,
  initialItems,
  profileSyncId,
  rawItemEntities,
  accounts = [],
  onClose,
  onSaved,
}: {
  initial: InvoiceRow | null;
  initialItems: ItemRow[];
  profileSyncId: string | null;
  /** Pro edit režim — všechny existující invoice_items (pro soft-delete odstraněných řádků). */
  rawItemEntities: SyncEntity[];
  /** Účty profilu pro picker linkedAccountId (volitelné — bez nich se picker neukáže). */
  accounts?: Array<{ syncId: string; data: { name: string; type?: string } }>;
  onClose: () => void;
  onSaved: (syncId: string) => void;
}) {
  const t = useTranslations("invoice_editor");
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.data.invoiceNumber ?? "");
  const [isExpense, setIsExpense] = useState(initial?.data.isExpense ?? true);
  const [issueDate, setIssueDate] = useState(
    initial?.data.issueDate ?? new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(initial?.data.dueDate ?? "");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [paymentMethod, setPaymentMethod] = useState(
    initial?.data.paymentMethod ?? "BANK_TRANSFER",
  );
  const [variableSymbol, setVariableSymbol] = useState(initial?.data.variableSymbol ?? "");
  const [bankAccount, setBankAccount] = useState(initial?.data.bankAccount ?? "");
  const [paid, setPaid] = useState(initial?.data.paid ?? false);
  const [supplierName, setSupplierName] = useState(initial?.data.supplierName ?? "");
  const [supplierIco, setSupplierIco] = useState(initial?.data.supplierIco ?? "");
  const [supplierDic, setSupplierDic] = useState(initial?.data.supplierDic ?? "");
  const [supplierStreet, setSupplierStreet] = useState(initial?.data.supplierStreet ?? "");
  const [supplierCity, setSupplierCity] = useState(initial?.data.supplierCity ?? "");
  const [supplierZip, setSupplierZip] = useState(initial?.data.supplierZip ?? "");
  const [customerName, setCustomerName] = useState(initial?.data.customerName ?? "");
  const [note, setNote] = useState(initial?.data.note ?? "");
  const [linkedAccountId, setLinkedAccountId] = useState(initial?.data.linkedAccountId ?? "");

  const [items, setItems] = useState<DraftItem[]>(() =>
    initialItems.length > 0
      ? initialItems.map((it) => ({
          syncId: it.syncId,
          name: it.data.name ?? "",
          quantity: String(it.data.quantity ?? "1"),
          totalPriceWithVat: String(it.data.totalPriceWithVat ?? "0"),
          vatRate: String(it.data.vatRate ?? "21"),
        }))
      : [{ syncId: crypto.randomUUID(), name: "", quantity: "1", totalPriceWithVat: "", vatRate: "21" }],
  );

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{
    number: string;
    date: string;
    amount: string;
  } | null>(null);

  // Auto-spočti součet z položek (pokud je něco vyplněné), jinak nech ručně
  const itemsTotal = useMemo(
    () => items.reduce((s, it) => s + (parseFloat(it.totalPriceWithVat.replace(",", ".")) || 0), 0),
    [items],
  );
  const [overrideTotal, setOverrideTotal] = useState(initial?.data.totalWithVat ?? "");
  const totalToSave = overrideTotal
    ? parseFloat(overrideTotal.replace(",", ".")) || 0
    : itemsTotal;

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        syncId: crypto.randomUUID(),
        name: "",
        quantity: "1",
        totalPriceWithVat: "",
        vatRate: "21",
      },
    ]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save(force = false) {
    if (!profileSyncId) return setErr(t("no_profile"));
    if (totalToSave <= 0) return setErr(t("fill_amount"));
    if (!isExpense && !customerName.trim() && !supplierName.trim()) {
      setErr(t("fill_customer"));
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      // Kontrola duplicity podle čísla faktury — pro nové i upravované.
      // Match je v rámci aktivního profilu, ignoruje smazané (deletedAt) a
      // při editaci vylučuje fakturu, kterou právě upravujeme (initial.syncId).
      // Tj. zachytí: 1) novou fakturu s číslem, co už existuje,
      //              2) editaci, která změní číslo na číslo jiné existující.
      const trimmedNumber = invoiceNumber.trim();
      if (!force && trimmedNumber) {
        const res = await withAuth((tk) => sync.pull(tk));
        const selfSyncId = initial?.syncId;
        const dupEntity = (res.entities["invoices"] ?? []).find((e) => {
          if (e.syncId === selfSyncId) return false;       // sebe ignoruj
          if (e.deletedAt) return false;
          const d = e.data as Record<string, unknown>;
          if (d.deletedAt != null && d.deletedAt !== 0) return false;
          if (d.profileId !== profileSyncId) return false;
          const n = String(d.invoiceNumber ?? "").trim();
          return n.length > 0 && n === trimmedNumber;
        });
        if (dupEntity) {
          const d = dupEntity.data as Record<string, unknown>;
          setDuplicate({
            number: String(d.invoiceNumber ?? trimmedNumber),
            date: String(d.issueDate ?? "—"),
            amount: `${String(d.totalWithVat ?? "?")} ${String(d.currency ?? "")}`.trim(),
          });
          setSaving(false);
          return;
        }
      }

      const now = new Date().toISOString();
      const invoiceSyncId = initial?.syncId ?? crypto.randomUUID();

      // null místo undefined = explicit clear na serveru. undefined by JSON.stringify
      // vyhodil úplně, server by aplikoval containsKey guard a pole NEsmazal — což
      // je špatně, když uživatel pole vyprázdnil vědomě. Více v fix(sync) commitu.
      const orNull = (v: string) => (v.trim().length > 0 ? v.trim() : null);
      const data: InvoiceData = {
        profileId: profileSyncId,
        invoiceNumber: orNull(invoiceNumber),
        isExpense,
        issueDate,
        dueDate: dueDate || null,
        totalWithVat: totalToSave.toFixed(2),
        totalWithoutVat: initial?.data.totalWithoutVat,
        currency,
        paymentMethod,
        variableSymbol: orNull(variableSymbol),
        bankAccount: orNull(bankAccount),
        paid,
        supplierName: orNull(supplierName),
        supplierIco: orNull(supplierIco),
        supplierDic: orNull(supplierDic),
        supplierStreet: orNull(supplierStreet),
        supplierCity: orNull(supplierCity),
        supplierZip: orNull(supplierZip),
        customerName: orNull(customerName),
        note: orNull(note),
        fileKeys: initial?.data.fileKeys ?? [],
        linkedAccountId: linkedAccountId || null,
      };

      // Položky — uložit aktuální + soft-delete ty, co byly v initialItems ale už nejsou
      const validItems = items.filter((it) => it.name.trim() && parseFloat(it.totalPriceWithVat.replace(",", ".")) > 0);
      const currentSyncIds = new Set(validItems.map((it) => it.syncId));
      const itemPayload = validItems.map((it, idx) => ({
        syncId: it.syncId,
        updatedAt: now,
        clientVersion: 1,
        data: {
          invoiceId: invoiceSyncId,
          name: it.name.trim(),
          quantity: it.quantity || "1",
          totalPriceWithVat: parseFloat(it.totalPriceWithVat.replace(",", ".")).toFixed(2),
          vatRate: parseFloat(it.vatRate || "21").toString(),
          position: idx,
        } as Record<string, unknown>,
      }));

      // Soft-delete řádků odebraných z editoru
      const deletedItems = rawItemEntities
        .filter((e) => {
          const d = e.data as Record<string, unknown>;
          return d.invoiceId === invoiceSyncId && !e.deletedAt && !currentSyncIds.has(e.syncId);
        })
        .map((e) => ({
          syncId: e.syncId,
          updatedAt: now,
          deletedAt: now,
          clientVersion: 1,
          data: e.data as Record<string, unknown>,
        }));

      const allItemEntries = [...itemPayload, ...deletedItems];

      await withAuth((t) =>
        sync.push(t, {
          entities: {
            invoices: [
              {
                syncId: invoiceSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
            ...(allItemEntries.length > 0 ? { invoice_items: allItemEntries } : {}),
          },
        }),
      );
      onSaved(invoiceSyncId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? t("edit_title") : t("new_title")}
      onClose={onClose}
      onSave={() => save(false)}
      saving={saving}
      error={err}
      saveLabel={initial ? t("save_changes") : t("create_invoice")}
    >
      {duplicate && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-2">
          <div className="font-medium text-amber-900">{t("dup_title")}</div>
          <div className="text-amber-800">
            {t("dup_desc", {
              number: duplicate.number,
              date: duplicate.date,
              amount: duplicate.amount,
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDuplicate(null);
                save(true);
              }}
              className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
            >
              {t("dup_save_anyway")}
            </button>
            <button
              type="button"
              onClick={() => setDuplicate(null)}
              className="px-3 py-1.5 rounded border border-amber-300 text-amber-800 text-xs"
            >
              {t("dup_cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => setIsExpense(true)}
          className={`flex-1 py-2 ${isExpense ? "bg-red-50 text-red-700 font-medium" : "text-ink-700"}`}
        >
          {t("received_expense")}
        </button>
        <button
          type="button"
          onClick={() => setIsExpense(false)}
          className={`flex-1 py-2 ${!isExpense ? "bg-emerald-50 text-emerald-700 font-medium" : "text-ink-700"}`}
        >
          {t("issued_income")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("invoice_number")}>
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className={inputClass}
            placeholder="2026001"
          />
        </Field>
        <Field label={t("currency")}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("issue_date")}>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("due_date")}>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {accounts.length > 0 && (
        <Field label={t("linked_account")}>
          <select
            value={linkedAccountId}
            onChange={(e) => setLinkedAccountId(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("unassigned")}</option>
            {accounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>{a.data.name}</option>
            ))}
          </select>
        </Field>
      )}

      {/* Partner */}
      <div className="border border-ink-200 rounded-lg p-3 space-y-3">
        <div className="text-xs font-semibold text-ink-700">
          {isExpense ? t("supplier") : t("customer")}
        </div>
        <Field label={t("name")}>
          <input
            type="text"
            value={isExpense ? supplierName : customerName}
            onChange={(e) =>
              isExpense ? setSupplierName(e.target.value) : setCustomerName(e.target.value)
            }
            className={inputClass}
          />
        </Field>
        {isExpense && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("ico")}>
                <input
                  type="text"
                  value={supplierIco}
                  onChange={(e) => setSupplierIco(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label={t("dic")}>
                <input
                  type="text"
                  value={supplierDic}
                  onChange={(e) => setSupplierDic(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={t("street")}>
              <input
                type="text"
                value={supplierStreet}
                onChange={(e) => setSupplierStreet(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("zip")}>
                <input
                  type="text"
                  value={supplierZip}
                  onChange={(e) => setSupplierZip(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="col-span-2">
                <Field label={t("city")}>
                  <input
                    type="text"
                    value={supplierCity}
                    onChange={(e) => setSupplierCity(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Items */}
      <div className="border border-ink-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-ink-700">{t("items")}</div>
          <div className="text-xs text-ink-500 tabular-nums">
            {t("totals")}: {itemsTotal.toFixed(2)} {currency}
          </div>
        </div>
        {items.map((it, idx) => (
          <div key={it.syncId} className="space-y-1">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <input
                  type="text"
                  value={it.name}
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  placeholder={t("item_name_placeholder")}
                  className={`${inputClass} text-xs`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="text-red-500 hover:text-red-700 text-sm shrink-0 px-1"
                title={t("remove_row")}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                placeholder={t("item_qty")}
                className={`${inputClass} text-xs`}
              />
              <select
                value={it.vatRate}
                onChange={(e) => updateItem(idx, { vatRate: e.target.value })}
                className={`${inputClass} text-xs`}
              >
                <option value="0">0 %</option>
                <option value="10">10 %</option>
                <option value="12">12 %</option>
                <option value="21">21 %</option>
              </select>
              <input
                type="text"
                inputMode="decimal"
                value={it.totalPriceWithVat}
                onChange={(e) => updateItem(idx, { totalPriceWithVat: e.target.value })}
                placeholder={t("item_total_with_vat")}
                className={`${inputClass} text-xs tabular-nums`}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="w-full py-1.5 rounded border border-dashed border-ink-300 hover:border-brand-500 hover:bg-brand-50 text-xs text-ink-600 hover:text-brand-700"
        >
          {t("add_item")}
        </button>
      </div>

      <Field label={`${t("total_with_vat")} (${currency})`}>
        <input
          type="text"
          inputMode="decimal"
          value={overrideTotal}
          onChange={(e) => setOverrideTotal(e.target.value)}
          placeholder={itemsTotal > 0 ? `${itemsTotal.toFixed(2)} ${t("from_items_suffix")}` : "0.00"}
          className={inputClass}
        />
      </Field>

      {/* Payment */}
      <div className="border border-ink-200 rounded-lg p-3 space-y-3">
        <div className="text-xs font-semibold text-ink-700">{t("method")}</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("method")}>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className={inputClass}
            >
              <option value="BANK_TRANSFER">{t("method_bank")}</option>
              <option value="CARD">{t("method_card")}</option>
              <option value="CASH">{t("method_cash")}</option>
              <option value="OTHER">{t("method_other")}</option>
            </select>
          </Field>
          <Field label={t("vs")}>
            <input
              type="text"
              value={variableSymbol}
              onChange={(e) => setVariableSymbol(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label={t("bank_account")}>
          <input
            type="text"
            value={bankAccount}
            onChange={(e) => setBankAccount(e.target.value)}
            className={inputClass}
            placeholder="123456789/0100"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            className="w-4 h-4"
          />
          {t("paid_label")}
        </label>
      </div>

      <Field label={t("note")}>
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
