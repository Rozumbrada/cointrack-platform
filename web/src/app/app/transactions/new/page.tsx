"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { getCurrentProfileId } from "@/lib/profile-store";
import { useSyncData } from "@/lib/sync-hook";

interface AccountData {
  id?: number;
  name: string;
  currency: string;
}

interface CategoryData {
  id?: number;
  name: string;
  icon?: string;
  type: "INCOME" | "EXPENSE";
}

export default function NewTransactionPage() {
  const router = useRouter();
  const { entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<AccountData>("accounts");
  const categories = entitiesByProfile<CategoryData>("categories");

  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select první účet / kategorie když se načtou
  if (!accountId && accounts.length > 0 && accounts[0].data.id != null) {
    setAccountId(String(accounts[0].data.id));
  }

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.data.type === type),
    [categories, type],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const profileSyncId = getCurrentProfileId();   // UUID string
    const accId = Number.parseInt(accountId, 10);
    const amt = Number.parseFloat(amount.replace(",", "."));

    if (!profileSyncId) {
      setError("Není vybraný profil.");
      return;
    }
    if (!accId || Number.isNaN(accId)) {
      setError("Vyber účet.");
      return;
    }
    if (!amt || Number.isNaN(amt) || amt <= 0) {
      setError("Zadej platnou částku.");
      return;
    }

    const account = accounts.find((a) => a.data.id === accId);
    const currency = account?.data.currency ?? "CZK";

    setSaving(true);
    try {
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      const dateTime = `${date}T${now.slice(11, 19)}`;

      await withAuth((t) =>
        sync.push(t, {
          entities: {
            transactions: [
              {
                syncId,
                updatedAt: now,
                clientVersion: 1,
                data: {
                  type,
                  amount: amt,
                  currency,
                  accountId: accId,
                  categoryId: categoryId ? Number.parseInt(categoryId, 10) : null,
                  note,
                  dateTime,
                  profileId: profileSyncId,  // UUID string, backend dedup expects string
                },
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

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět na transakce
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900 mt-2">Nová transakce</h1>
        <p className="text-sm text-ink-600 mt-1">
          Záznam se sesynchronizuje do mobilní aplikace.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
        {/* Typ */}
        <div className="flex rounded-lg border border-ink-300 overflow-hidden">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-3 text-sm font-medium ${
                type === t
                  ? t === "EXPENSE"
                    ? "bg-red-50 text-red-700"
                    : "bg-emerald-50 text-emerald-700"
                  : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {t === "EXPENSE" ? "Výdaj" : "Příjem"}
            </button>
          ))}
        </div>

        {/* Částka */}
        <Field label="Částka">
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-lg text-ink-900 tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        {/* Účet */}
        <Field label="Účet">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            {accounts.length === 0 && <option value="">Nejsou účty</option>}
            {accounts.map((a) => (
              <option key={a.syncId} value={String(a.data.id ?? "")}>
                {a.data.name} ({a.data.currency})
              </option>
            ))}
          </select>
        </Field>

        {/* Kategorie */}
        <Field label="Kategorie (volitelné)">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            <option value="">Bez kategorie</option>
            {filteredCategories.map((c) => (
              <option key={c.syncId} value={String(c.data.id ?? "")}>
                {c.data.icon ? `${c.data.icon} ` : ""}
                {c.data.name}
              </option>
            ))}
          </select>
        </Field>

        {/* Datum */}
        <Field label="Datum">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          />
        </Field>

        {/* Poznámka */}
        <Field label="Poznámka">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="např. Oběd v Makru"
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <Link
            href="/app/transactions"
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
