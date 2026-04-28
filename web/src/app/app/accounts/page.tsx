"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncData } from "@/lib/sync-hook";

interface AccountData {
  name: string;
  type: "CASH" | "BANK" | "CREDIT_CARD" | "INVESTMENT" | "OTHER";
  balance: number;
  currency: string;
  color?: number;
  includeInTotal: boolean;
  externalProvider?: string;
  profileId?: number;
  bankIban?: string;
  bankAccountNumber?: string;
  bankCode?: string;
  pohodaShortcut?: string;
}

export default function AccountsPage() {
  const t = useTranslations("accounts_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<AccountData>("accounts");

  const sorted = useMemo(
    () => [...accounts].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [accounts],
  );

  const totals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of accounts) {
      if (!a.data.includeInTotal) continue;
      m[a.data.currency] = (m[a.data.currency] ?? 0) + a.data.balance;
    }
    return m;
  }, [accounts]);

  function fmt(amount: number, currency: string): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function labelType(type: AccountData["type"]): string {
    switch (type) {
      case "CASH": return t("type_cash");
      case "BANK": return t("type_bank");
      case "CREDIT_CARD": return t("type_credit");
      case "INVESTMENT": return t("type_investment");
      default: return t("type_other");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
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
          {sorted.map((a) => (
            <div
              key={a.syncId}
              className="bg-white rounded-2xl border border-ink-200 p-5"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-lg grid place-items-center text-xl"
                    style={{ backgroundColor: colorFromInt(a.data.color) }}
                  >
                    {iconForType(a.data.type)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-ink-900 truncate">
                      {a.data.name}
                    </div>
                    <div className="text-xs text-ink-500">
                      {labelType(a.data.type)}
                      {a.data.externalProvider && (
                        <span className="ml-2 text-[10px] uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                          {a.data.externalProvider}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-2xl font-semibold text-ink-900 tabular-nums">
                {fmt(a.data.balance, a.data.currency)}
              </div>
              {!a.data.includeInTotal && (
                <div className="text-[10px] uppercase text-ink-500 mt-2">
                  {t("excluded_from_total")}
                </div>
              )}
              {(a.data.bankAccountNumber || a.data.bankCode || a.data.bankIban) && (
                <div className="mt-3 pt-3 border-t border-ink-100 space-y-1 text-xs text-ink-600">
                  {a.data.bankAccountNumber && a.data.bankCode && (
                    <div>
                      <span className="text-ink-500">{t("account_number")} </span>
                      <span className="font-mono">{a.data.bankAccountNumber}/{a.data.bankCode}</span>
                    </div>
                  )}
                  {a.data.bankIban && (
                    <div>
                      <span className="text-ink-500">{t("iban")} </span>
                      <span className="font-mono">{a.data.bankIban}</span>
                    </div>
                  )}
                  {a.data.pohodaShortcut && (
                    <div>
                      <span className="text-ink-500">{t("pohoda_shortcut")} </span>
                      <span className="font-mono font-medium">{a.data.pohodaShortcut}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function iconForType(t: AccountData["type"]): string {
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
