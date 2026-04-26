"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  computeTxType,
} from "@/lib/sync-types";

type TxType = "INCOME" | "EXPENSE" | "TRANSFER";

export default function EditTransactionPage() {
  const router = useRouter();
  const params = useParams<{ syncId: string }>();
  const syncId = params.syncId;

  const { loading, entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const categories = entitiesByProfile<ServerCategory>("categories");
  const transactions = entitiesByProfile<ServerTransaction>("transactions");

  const tx = transactions.find((t) => t.syncId === syncId);

  const [type, setType] = useState<TxType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (tx && !hydrated) {
      const t = computeTxType(tx.data);
      const signed = parseFloat(tx.data.amount) || 0;
      setType(t);
      setAmount(String(Math.abs(signed)));
      setAccountId(tx.data.accountId ?? "__cash__");
      setCategoryId(tx.data.categoryId ?? "");
      setDescription(tx.data.description ?? "");
      setMerchant(tx.data.merchant ?? "");
      setDate(tx.data.date ?? "");
      setHydrated(true);
    }
  }, [tx, hydrated]);

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
    if (!tx) return;
    setError(null);

    const amt = Number.parseFloat(amount.replace(",", "."));
    const isCash = accountId === "__cash__";
    if (!isCash && !accountId) {
      setError("Vyber účet (nebo Hotovost).");
      return;
    }
    if (!amt || Number.isNaN(amt) || amt <= 0) {
      setError("Zadej platnou částku.");
      return;
    }
    if (!date) {
      setError("Zadej datum.");
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const signedAmount = type === "EXPENSE" ? -Math.abs(amt) : Math.abs(amt);
      const merged: ServerTransaction = {
        ...tx.data,
        accountId: isCash ? undefined : accountId,
        categoryId: type === "TRANSFER" ? undefined : categoryId || undefined,
        amount: signedAmount.toFixed(2),
        description: description || undefined,
        merchant: merchant || undefined,
        date,
        isTransfer: type === "TRANSFER",
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            transactions: [
              {
                syncId: tx.syncId,
                updatedAt: now,
                clientVersion: 1,
                data: merged as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      router.push(`/app/transactions/${tx.syncId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!tx) return;
    if (!confirm("Opravdu smazat tuto transakci?")) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            transactions: [
              {
                syncId: tx.syncId,
                updatedAt: now,
                deletedAt: now,
                clientVersion: 1,
                data: tx.data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      router.push("/app/transactions");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;

  if (!tx) {
    return (
      <div className="max-w-xl space-y-4">
        <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Transakci <code>{syncId}</code> jsem nenašel. Možná byla smazaná nebo patří do jiného
          profilu — přepni v sidebaru a zkus znovu.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href={`/app/transactions/${tx.syncId}`}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          ← Zpět na detail
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900 mt-2">Upravit transakci</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
        <div className="flex rounded-lg border border-ink-300 overflow-hidden">
          {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-3 text-sm font-medium ${
                type === t
                  ? t === "EXPENSE"
                    ? "bg-red-50 text-red-700"
                    : t === "INCOME"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-ink-100 text-ink-700"
                  : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {t === "EXPENSE" ? "Výdaj" : t === "INCOME" ? "Příjem" : "Převod"}
            </button>
          ))}
        </div>

        <Field label="Částka">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-lg text-ink-900 tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label="Účet">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            <option value="__cash__">💵 Hotovost (bez vazby na účet)</option>
            {accounts.length > 0 && <option disabled>──────────</option>}
            {accounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>
                {a.data.name} ({a.data.currency})
              </option>
            ))}
          </select>
        </Field>

        {type !== "TRANSFER" && (
          <Field label="Kategorie">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
            >
              <option value="">Bez kategorie</option>
              {filteredCategories.map((c) => (
                <option key={c.syncId} value={c.syncId}>
                  {c.data.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Datum">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          />
        </Field>

        <Field label="Obchodník">
          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Albert, Lidl, …"
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label="Poznámka">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="h-11 px-4 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 text-sm font-medium"
          >
            Smazat
          </button>
          <Link
            href={`/app/transactions/${tx.syncId}`}
            className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
          >
            Zrušit
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {saving ? "Ukládám…" : "Uložit"}
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
