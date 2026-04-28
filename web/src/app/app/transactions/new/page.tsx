"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount, ServerCategory, ServerTransaction } from "@/lib/sync-types";

export default function NewTransactionPage() {
  const router = useRouter();
  const t = useTranslations("transaction_form");
  const { entitiesByProfile, profileSyncId } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const categories = entitiesByProfile<ServerCategory>("categories");

  const [type, setType] = useState<"INCOME" | "EXPENSE" | "TRANSFER">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accountId && accounts.length > 0) {
    setAccountId(accounts[0].syncId);
  }

  const filteredCategories = useMemo(
    () =>
      type === "TRANSFER"
        ? []
        : categories
            .filter((c) => c.data.type?.toUpperCase() === type)
            .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categories, type],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amt = Number.parseFloat(amount.replace(",", "."));

    if (!profileSyncId) {
      setError(t("no_profile"));
      return;
    }
    const isCash = accountId === "__cash__";
    if (!isCash && !accountId) {
      setError(t("select_account"));
      return;
    }
    if (!amt || Number.isNaN(amt) || amt <= 0) {
      setError(t("invalid_amount"));
      return;
    }

    const account = isCash ? undefined : accounts.find((a) => a.syncId === accountId);
    const currency = account?.data.currency ?? "CZK";

    setSaving(true);
    try {
      const newSyncId = crypto.randomUUID();
      const now = new Date().toISOString();
      const signedAmount = type === "EXPENSE" ? -Math.abs(amt) : Math.abs(amt);

      const data: ServerTransaction = {
        profileId: profileSyncId,
        accountId: isCash ? undefined : accountId,
        categoryId: type === "TRANSFER" ? undefined : categoryId || undefined,
        amount: signedAmount.toFixed(2),
        currency,
        description: description || undefined,
        merchant: merchant || undefined,
        date,
        isTransfer: type === "TRANSFER",
      };

      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            transactions: [
              {
                syncId: newSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      router.push(`/app/transactions/${newSyncId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900 mt-2">{t("new_title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
        <div className="flex rounded-lg border border-ink-300 overflow-hidden">
          {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setType(tp)}
              className={`flex-1 py-3 text-sm font-medium ${
                type === tp
                  ? tp === "EXPENSE"
                    ? "bg-red-50 text-red-700"
                    : tp === "INCOME"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-ink-100 text-ink-700"
                  : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {tp === "EXPENSE" ? t("type_expense") : tp === "INCOME" ? t("type_income") : t("type_transfer")}
            </button>
          ))}
        </div>

        <Field label={t("field_amount")}>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            placeholder={t("amount_placeholder")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-lg text-ink-900 tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label={t("field_account")}>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            <option value="__cash__">{t("cash_option")}</option>
            {accounts.length > 0 && <option disabled>──────────</option>}
            {accounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>
                {a.data.name} ({a.data.currency})
              </option>
            ))}
          </select>
        </Field>

        {type !== "TRANSFER" && (
          <Field label={t("field_category")}>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
            >
              <option value="">{t("no_category")}</option>
              {filteredCategories.map((c) => (
                <option key={c.syncId} value={c.syncId}>
                  {c.data.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t("field_date")}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          />
        </Field>

        <Field label={t("field_merchant")}>
          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={t("merchant_placeholder")}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label={t("field_description")}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("description_placeholder")}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <Link
            href="/app/transactions"
            className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
          >
            {t("cancel")}
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-900 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
