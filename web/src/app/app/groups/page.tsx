"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface GroupMemberData {
  id?: number;
  profileId: number;
  name: string;
  userId?: string;
  color?: number;
}

interface GroupExpenseData {
  id?: number;
  profileId: number;
  description: string;
  amount: number;
  currency: string;
  date: string;
  paidByMemberId: number;
}

interface GroupExpenseItemData {
  id?: number;
  expenseId: number;
  memberId: number;
  share: number;            // normalizovaný podíl (0..1 nebo absolute amount)
}

interface ProfileData {
  id?: number;
  name: string;
  isGroup?: boolean;
}

export default function GroupsPage() {
  const { loading, error, entitiesByProfile, rawEntities } = useSyncData();

  const members = entitiesByProfile<GroupMemberData>("group_members");
  const expenses = entitiesByProfile<GroupExpenseData>("group_expenses");
  const items = rawEntities("group_expense_items"); // nejsou scoped by profileId (scope = GROUP_EXPENSE)

  // Jméno profilu pro titulek
  const profiles = rawEntities("profiles");

  const currentProfile = useMemo(() => {
    const pid = Number(
      typeof window !== "undefined"
        ? localStorage.getItem("cointrack_currentProfileId")
        : null,
    );
    return profiles
      .map((e) => e.data as unknown as ProfileData)
      .find((p) => p.id === pid);
  }, [profiles]);

  const isGroup = currentProfile?.isGroup ?? false;

  // Map member ID → member data
  const memberMap = useMemo(() => {
    const m = new Map<number, GroupMemberData>();
    members.forEach((x) => x.data.id && m.set(x.data.id, x.data));
    return m;
  }, [members]);

  // Map expense ID → items
  const itemsByExpense = useMemo(() => {
    const m = new Map<number, GroupExpenseItemData[]>();
    items.forEach((e) => {
      const d = e.data as unknown as GroupExpenseItemData;
      if (d.expenseId == null) return;
      const arr = m.get(d.expenseId) ?? [];
      arr.push(d);
      m.set(d.expenseId, arr);
    });
    return m;
  }, [items]);

  // Spočítej, kolik každý člen dlužil / zaplatil
  const balances = useMemo(() => {
    const b = new Map<number, number>(); // +kladné = věřitel (přeplatek), záporné = dlužník
    for (const ex of expenses) {
      const paidBy = ex.data.paidByMemberId;
      if (paidBy == null) continue;
      b.set(paidBy, (b.get(paidBy) ?? 0) + ex.data.amount);

      const exId = ex.data.id;
      const shareItems = exId != null ? itemsByExpense.get(exId) ?? [] : [];
      if (shareItems.length === 0) continue;
      // Nejdřív zjistíme typ rozdělení — součet share = 1 (proporce) nebo = amount (absolutní)
      const totalShare = shareItems.reduce((s, i) => s + i.share, 0);
      const isProportional = Math.abs(totalShare - 1) < 0.001;
      for (const it of shareItems) {
        const owed = isProportional ? ex.data.amount * it.share : it.share;
        b.set(it.memberId, (b.get(it.memberId) ?? 0) - owed);
      }
    }
    return b;
  }, [expenses, itemsByExpense]);

  // Simplified "kdo komu dluží" — pair smallest debtor with largest creditor
  const settlements = useMemo(() => {
    const creditors = Array.from(balances.entries())
      .filter(([, v]) => v > 0.01)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => ({ id, amount: v }));
    const debtors = Array.from(balances.entries())
      .filter(([, v]) => v < -0.01)
      .sort((a, b) => a[1] - b[1])
      .map(([id, v]) => ({ id, amount: -v }));
    const result: Array<{ from: number; to: number; amount: number }> = [];
    let ci = 0;
    let di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const transfer = Math.min(creditors[ci].amount, debtors[di].amount);
      if (transfer > 0.01) {
        result.push({ from: debtors[di].id, to: creditors[ci].id, amount: transfer });
      }
      creditors[ci].amount -= transfer;
      debtors[di].amount -= transfer;
      if (creditors[ci].amount < 0.01) ci++;
      if (debtors[di].amount < 0.01) di++;
    }
    return result;
  }, [balances]);

  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((a, b) =>
        (b.data.date ?? "").localeCompare(a.data.date ?? ""),
      ),
    [expenses],
  );

  if (!isGroup && !loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Skupinové výdaje</h1>
          <p className="text-sm text-ink-600 mt-1">
            Tato sekce funguje jen pro <strong>skupinové profily</strong>.
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <div className="font-medium text-ink-900">Aktuální profil není skupina</div>
          <p className="text-sm text-ink-600 mt-2">
            V horním profile switcheru vyber skupinový profil, nebo ho vytvoř v mobilní aplikaci
            (Organizace → Nová skupina).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">
          {currentProfile?.name ?? "Skupina"}
        </h1>
        <p className="text-sm text-ink-600 mt-1">
          Sdílené výdaje, kdo kolik zaplatil a kdo komu dluží.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : (
        <>
          {/* Zůstatky */}
          {members.length > 0 && (
            <section className="bg-white rounded-2xl border border-ink-200">
              <div className="px-6 py-3 border-b border-ink-200">
                <h2 className="font-semibold text-ink-900">Zůstatky členů</h2>
              </div>
              <ul className="divide-y divide-ink-100">
                {members.map((m) => {
                  const bal = m.data.id != null ? balances.get(m.data.id) ?? 0 : 0;
                  return (
                    <li key={m.syncId} className="px-6 py-3 flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full grid place-items-center text-xs font-medium"
                        style={{ backgroundColor: colorFromInt(m.data.color) }}
                      >
                        {m.data.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 text-sm text-ink-900">{m.data.name}</div>
                      <div
                        className={`text-sm font-semibold tabular-nums ${
                          bal > 0.01
                            ? "text-emerald-700"
                            : bal < -0.01
                              ? "text-red-700"
                              : "text-ink-500"
                        }`}
                      >
                        {bal > 0.01 ? "+" : ""}
                        {fmt(bal, "CZK")}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Kdo komu dluží */}
          {settlements.length > 0 && (
            <section className="bg-white rounded-2xl border border-ink-200">
              <div className="px-6 py-3 border-b border-ink-200">
                <h2 className="font-semibold text-ink-900">Kdo komu dluží</h2>
              </div>
              <ul className="divide-y divide-ink-100">
                {settlements.map((s, i) => {
                  const from = memberMap.get(s.from);
                  const to = memberMap.get(s.to);
                  return (
                    <li key={i} className="px-6 py-3 flex items-center gap-3 text-sm">
                      <div className="flex-1 text-ink-900">
                        <strong>{from?.name ?? "?"}</strong>{" "}
                        <span className="text-ink-500">dluží</span>{" "}
                        <strong>{to?.name ?? "?"}</strong>
                      </div>
                      <div className="font-semibold tabular-nums text-ink-900">
                        {fmt(s.amount, "CZK")}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Výdaje */}
          <section className="bg-white rounded-2xl border border-ink-200">
            <div className="px-6 py-3 border-b border-ink-200">
              <h2 className="font-semibold text-ink-900">Výdaje</h2>
            </div>
            {sortedExpenses.length === 0 ? (
              <div className="p-8 text-center text-ink-500 text-sm">
                Žádné výdaje. Přidej výdaj v mobilní aplikaci.
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {sortedExpenses.map((ex) => {
                  const payer = memberMap.get(ex.data.paidByMemberId);
                  return (
                    <li
                      key={ex.syncId}
                      className="px-6 py-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink-900 truncate">
                          {ex.data.description || "(bez popisu)"}
                        </div>
                        <div className="text-xs text-ink-500">
                          {ex.data.date}
                          {payer && <span> · zaplatil {payer.name}</span>}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-ink-900">
                        {fmt(ex.data.amount, ex.data.currency)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function colorFromInt(c?: number): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
