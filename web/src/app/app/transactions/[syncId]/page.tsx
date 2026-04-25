"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  computeTxType,
} from "@/lib/sync-types";
import {
  CategoryIcon,
  colorFromInt,
  colorFromIntSolid,
} from "@/components/app/CategoryIcon";

export default function TransactionDetailPage() {
  const router = useRouter();
  const params = useParams<{ syncId: string }>();
  const syncId = params.syncId;

  const { loading, error, entitiesByProfile, reload } = useSyncData();
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const cats = entitiesByProfile<ServerCategory>("categories");

  const tx = useMemo(() => txEntities.find((t) => t.syncId === syncId), [txEntities, syncId]);

  const account = useMemo(
    () => (tx?.data.accountId ? accounts.find((a) => a.syncId === tx.data.accountId) : undefined),
    [accounts, tx],
  );
  const category = useMemo(
    () => (tx?.data.categoryId ? cats.find((c) => c.syncId === tx.data.categoryId) : undefined),
    [cats, tx],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );
  if (!tx) {
    return (
      <div className="space-y-4">
        <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět
        </Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Transakci <code>{syncId}</code> jsem nenašel. Možná patří do jiného profilu — přepni
          v sidebaru.
        </div>
      </div>
    );
  }

  const d = tx.data;
  const txType = computeTxType(d);
  const signed = parseFloat(d.amount) || 0;
  const absAmount = Math.abs(signed);
  const sign = txType === "EXPENSE" ? "−" : txType === "INCOME" ? "+" : "";
  const typeLabel = txType === "EXPENSE" ? "Výdaj" : txType === "INCOME" ? "Příjem" : "Převod";
  const headerBg =
    txType === "EXPENSE" ? "bg-red-50" : txType === "INCOME" ? "bg-emerald-50" : "bg-brand-50";
  const headerText =
    txType === "EXPENSE" ? "text-red-700" : txType === "INCOME" ? "text-emerald-700" : "text-brand-700";

  const hasBankInfo =
    !!(d.bankVs || d.bankCounterparty || d.bankCounterpartyName || d.bankTxId);

  async function pushUpdate(patch: Partial<ServerTransaction>) {
    if (!tx) return;
    setBusy(true);
    setActionError(null);
    try {
      const now = new Date().toISOString();
      const merged: ServerTransaction = { ...tx.data, ...patch };
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
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!tx) return;
    if (!confirm("Opravdu smazat tuto transakci?")) return;
    setBusy(true);
    setActionError(null);
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
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět na transakce
        </Link>
        <div className="flex gap-3">
          <Link
            href={`/app/transactions/${tx.syncId}/edit`}
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            ✏️ Upravit
          </Link>
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            🗑 Smazat
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Amount header */}
      <section className={`rounded-2xl p-8 ${headerBg} text-center`}>
        <div className={`inline-block px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wide ${headerText} bg-white/60`}>
          {typeLabel}
        </div>
        <div className={`text-4xl font-bold mt-3 tabular-nums ${headerText}`}>
          {sign}
          {fmt(absAmount, d.currency)}
        </div>
        <div className="text-sm text-ink-600 mt-2">{formatDate(d.date)}</div>
      </section>

      {/* Category card (clickable) */}
      <button
        onClick={() => setPickerOpen(true)}
        disabled={busy}
        className="w-full bg-white rounded-2xl border border-ink-200 p-4 flex items-center gap-3 hover:bg-ink-50/50 transition-colors text-left"
      >
        <div
          className="w-10 h-10 rounded-full grid place-items-center shrink-0"
          style={{ backgroundColor: colorFromInt(category?.data.color) }}
        >
          <CategoryIcon name={category?.data.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-ink-500 uppercase tracking-wide">Kategorie</div>
          <div className={`text-base ${category ? "font-medium text-ink-900" : "text-ink-500"}`}>
            {category?.data.name ?? "— Bez kategorie —"}
          </div>
        </div>
        <div className="text-ink-400">›</div>
      </button>

      {/* Account card */}
      {account && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: colorFromInt(account.data.color) }}
          >
            <span
              className="material-icons"
              style={{ fontSize: "20px", color: colorFromIntSolid(account.data.color) }}
            >
              {account.data.icon || "account_balance"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-ink-500 uppercase tracking-wide">Účet</div>
            <div className="text-base font-medium text-ink-900 truncate">{account.data.name}</div>
          </div>
          <div className="text-xs text-ink-500">{account.data.currency}</div>
        </section>
      )}

      {/* Merchant card (if set and different from description) */}
      {d.merchant && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4 flex items-center gap-3">
          <span className="material-icons text-brand-600" style={{ fontSize: "20px" }}>
            store
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-ink-500 uppercase tracking-wide">Obchodník</div>
            <div className="text-base text-ink-900 truncate">{d.merchant}</div>
          </div>
        </section>
      )}

      {/* Description / note */}
      {d.description && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4 flex items-start gap-3">
          <span className="material-icons text-brand-600 mt-0.5" style={{ fontSize: "20px" }}>
            notes
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-ink-500 uppercase tracking-wide">Poznámka</div>
            <div className="text-base text-ink-900 whitespace-pre-wrap">{d.description}</div>
          </div>
        </section>
      )}

      {/* Bank info — pouze pro importované transakce */}
      {hasBankInfo && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="material-icons text-brand-600" style={{ fontSize: "18px" }}>
              account_balance
            </span>
            <h3 className="text-sm font-semibold text-ink-900">Bankovní údaje</h3>
          </div>
          <div className="border-t border-ink-100 pt-2 space-y-1.5 text-sm">
            {d.bankVs && <BankRow label="Variabilní symbol" value={d.bankVs} />}
            {d.bankCounterparty && <BankRow label="Protiúčet" value={d.bankCounterparty} />}
            {d.bankCounterpartyName && <BankRow label="Název protiúčtu" value={d.bankCounterpartyName} />}
            {d.bankTxId && <BankRow label="ID pohybu" value={d.bankTxId} />}
            {d.transferPairId && <BankRow label="Pár převodu" value={d.transferPairId} />}
          </div>
        </section>
      )}

      {pickerOpen && (
        <CategoryPicker
          allCategories={cats}
          currentSyncId={tx.data.categoryId}
          txType={txType}
          onSelect={async (catSyncId) => {
            setPickerOpen(false);
            await pushUpdate({ categoryId: catSyncId ?? undefined });
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function CategoryPicker({
  allCategories,
  currentSyncId,
  txType,
  onSelect,
  onClose,
}: {
  allCategories: Array<{ syncId: string; data: ServerCategory }>;
  currentSyncId?: string;
  txType: "INCOME" | "EXPENSE" | "TRANSFER";
  onSelect: (syncId: string | null) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    if (txType === "TRANSFER") return [];
    return [...allCategories]
      .filter((c) => c.data.type?.toUpperCase() === txType)
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
  }, [allCategories, txType]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-2 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-2">
          <h2 className="text-lg font-semibold text-ink-900">Vyber kategorii</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-1">
          <button
            onClick={() => onSelect(null)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-50 ${
              currentSyncId == null ? "bg-brand-50" : ""
            }`}
          >
            <div className="w-8 h-8 rounded-full grid place-items-center bg-ink-100 shrink-0">
              <span className="material-icons text-ink-500" style={{ fontSize: "18px" }}>
                block
              </span>
            </div>
            <div className="flex-1 text-left text-sm text-ink-700">Bez kategorie</div>
            {currentSyncId == null && (
              <span className="material-icons text-brand-600" style={{ fontSize: "18px" }}>
                check
              </span>
            )}
          </button>

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-500">
              {txType === "TRANSFER"
                ? "Převody nemají kategorii."
                : "Žádné kategorie tohoto typu. Vytvoř na stránce Kategorie."}
            </div>
          )}

          {filtered.map((c) => {
            const isSel = c.syncId === currentSyncId;
            return (
              <button
                key={c.syncId}
                onClick={() => onSelect(c.syncId)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-50 ${
                  isSel ? "bg-brand-50" : ""
                }`}
              >
                <div
                  className="w-8 h-8 rounded-full grid place-items-center shrink-0"
                  style={{ backgroundColor: colorFromInt(c.data.color) }}
                >
                  <CategoryIcon name={c.data.icon} size="sm" />
                </div>
                <div className="flex-1 text-left text-sm text-ink-900">{c.data.name}</div>
                {isSel && (
                  <span className="material-icons text-brand-600" style={{ fontSize: "18px" }}>
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BankRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500 text-xs">{label}</span>
      <span className="text-ink-900 font-medium text-sm break-all text-right">{value}</span>
    </div>
  );
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
