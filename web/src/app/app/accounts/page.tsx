"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerTransaction,
  computeAccountBalance,
} from "@/lib/sync-types";
import { Pencil, Trash2 } from "lucide-react";

export default function AccountsPage() {
  const t = useTranslations("accounts_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, reload } = useSyncData();
  const accountEntities = entitiesByProfile<ServerAccount>("accounts");
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");

  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Filter zombie účtů (Salt Edge import bez profile assignmentu — vznikly
   * v dávno smazaných profilech, zůstaly v cloudu jako "duchové"). Logika
   * sjednocena s Dashboardem.
   */
  const visibleAccounts = useMemo(() => {
    return accountEntities.filter((acc) => {
      const d = acc.data as unknown as Record<string, unknown>;
      const provider = d.bankProvider ?? d.externalProvider;
      if (provider === "saltedge") {
        const assigned = d.assignedProfileIds as string[] | undefined;
        if (!assigned || assigned.length === 0) return false;
      }
      return true;
    });
  }, [accountEntities]);

  const sorted = useMemo(
    () => [...visibleAccounts].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [visibleAccounts],
  );

  /** Live balance — initialBalance + sum tx (sjednoceno s Dashboard). */
  function balanceOf(acc: { syncId: string; data: ServerAccount }): number {
    return computeAccountBalance(acc.data, txEntities, acc.syncId);
  }

  const totals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of visibleAccounts) {
      if (a.data.excludedFromTotal) continue;
      const live = computeAccountBalance(a.data, txEntities, a.syncId);
      m[a.data.currency] = (m[a.data.currency] ?? 0) + live;
    }
    return Object.fromEntries(
      Object.entries(m).filter(([, v]) => Math.abs(v) > 0.005),
    );
  }, [visibleAccounts, txEntities]);

  function fmt(amount: number, currency: string): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function labelType(type: string | undefined): string {
    switch (type) {
      case "CASH": return t("type_cash");
      case "BANK": return t("type_bank");
      case "CREDIT_CARD": return t("type_credit");
      case "INVESTMENT": return t("type_investment");
      default: return t("type_other");
    }
  }

  /** Soft-delete účtu přes sync push. */
  async function deleteAccount(syncId: string, name: string) {
    if (!confirm(t("delete_confirm", { name }))) return;
    setActionError(null);
    const entity = accountEntities.find((a) => a.syncId === syncId);
    if (!entity) return;
    try {
      const now = new Date().toISOString();
      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            accounts: [
              {
                syncId: entity.syncId,
                updatedAt: now,
                deletedAt: now,
                clientVersion: 1,
                data: entity.data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle_short")}</p>
        </div>
        <Link
          href="/app/accounts/new"
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium leading-[2.5rem]"
        >
          {t("new_account")}
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {Object.keys(totals).length > 0 && (
        <div className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-2">
            {t("total_balance")}
          </div>
          {Object.entries(totals).map(([cur, amount]) => (
            <div key={cur} className="text-2xl font-semibold text-ink-900">
              {fmt(amount, cur)}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">💳</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((a) => {
            const balance = balanceOf(a);
            const d = a.data;
            return (
              <div
                key={a.syncId}
                className="bg-white rounded-2xl border border-ink-200 p-5 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-10 h-10 rounded-lg grid place-items-center text-xl shrink-0"
                      style={{ backgroundColor: colorFromInt(d.color) }}
                    >
                      {iconForType(d.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink-900 truncate">
                        {d.name}
                      </div>
                      <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
                        <span>{labelType(d.type)}</span>
                        {(d.bankProvider || d.externalProvider) && (
                          <span className="text-[10px] uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                            {d.bankProvider ?? d.externalProvider}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Edit + delete vždy viditelné */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/app/accounts/${a.syncId}/edit`}
                      title={t("edit")}
                      aria-label={t("edit")}
                      className="p-2 rounded-lg text-ink-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteAccount(a.syncId, d.name)}
                      title={t("delete")}
                      aria-label={t("delete")}
                      className="p-2 rounded-lg text-ink-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="text-2xl font-semibold text-ink-900 tabular-nums">
                  {fmt(balance, d.currency)}
                </div>
                {d.excludedFromTotal && (
                  <div className="text-[10px] uppercase text-ink-500 mt-2">
                    {t("excluded_from_total")}
                  </div>
                )}
                {(d.bankAccountNumber || d.bankCode || d.bankIban) && (
                  <div className="mt-3 pt-3 border-t border-ink-100 space-y-1 text-xs text-ink-600">
                    {d.bankAccountNumber && d.bankCode && (
                      <div>
                        <span className="text-ink-500">{t("account_number")} </span>
                        <span className="font-mono">{d.bankAccountNumber}/{d.bankCode}</span>
                      </div>
                    )}
                    {d.bankIban && (
                      <div>
                        <span className="text-ink-500">{t("iban")} </span>
                        <span className="font-mono">{d.bankIban}</span>
                      </div>
                    )}
                    {d.pohodaShortcut && (
                      <div>
                        <span className="text-ink-500">{t("pohoda_shortcut")} </span>
                        <span className="font-mono font-medium">{d.pohodaShortcut}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function iconForType(t: string | undefined): string {
  switch (t) {
    case "CASH": return "💵";
    case "BANK": return "🏦";
    case "CREDIT_CARD": return "💳";
    case "INVESTMENT": return "📈";
    default: return "💰";
  }
}

function colorFromInt(c?: number): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}
