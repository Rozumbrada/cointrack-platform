/**
 * TypeScript reprezentace dat tak, jak je serveruje Ktor backend ze sync endpointu.
 *
 * DŮLEŽITÉ: server používá vlastní normalizovaný tvar, který se LIŠÍ od
 * Android Room modelu. Mobilní klient mapuje při push/pull mezi nimi:
 *  - Android `Transaction.note`            → server `description`
 *  - Android `Transaction.dateTime`        → server `date` (jen datum)
 *  - Android `Transaction.type` (enum)     → server `amount` (signed) + `isTransfer`
 *  - Android `Transaction.accountId: Long` → server `accountId: UUID string`
 *  - Android `Account.balance` (live)      → server `initialBalance` (počáteční,
 *                                              skutečný se počítá z transakcí)
 */

// ─── Server-side data shapes ──────────────────────────────────────────

export interface ServerProfile {
  name: string;
  type?: string;
  color?: number;
  ico?: string;
  dic?: string;
  isVatPayer?: boolean;
  companyName?: string;
  defaultCurrency?: string;
  organizationId?: string;
  cointrackUserId?: string;
}

export interface ServerAccount {
  profileId: string;
  name: string;
  type: string;
  currency: string;
  /** Počáteční zůstatek (nikoli aktuální) — server je stateless, klient sčítá tx. */
  initialBalance: string;
  color?: number;
  icon?: string;
  excludedFromTotal?: boolean;
  bankProvider?: string;
  bankIban?: string;
  /** Číslo účtu bez kódu banky (např. "0000192000145399"). Pro Pohoda XML export. */
  bankAccountNumber?: string;
  /** Kód banky (např. "0100" pro KB). Pro Pohoda XML export. */
  bankCode?: string;
}

export interface ServerCategory {
  profileId: string;
  name: string;
  nameEn?: string;
  /** Server posílá lowercase ("expense"/"income"). Vždy normalizuj přes toUpperCase() při porovnávání. */
  type: string;
  color?: number;
  icon?: string;
  position?: number;
}

export interface ServerTransaction {
  profileId: string;
  accountId?: string;        // UUID string
  categoryId?: string;       // UUID string
  /** Signed: negative = výdaj, positive = příjem. */
  amount: string;
  currency: string;
  description?: string;      // = mobile.note
  merchant?: string;
  date: string;              // YYYY-MM-DD
  isTransfer: boolean;
  transferPairId?: string;
  bankTxId?: string;
  bankVs?: string;
  bankCounterparty?: string;
  bankCounterpartyName?: string;
}

// ─── Computed types pro UI ─────────────────────────────────────────────

export type TxType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface UiTransaction {
  syncId: string;
  profileId: string;
  accountSyncId?: string;
  categorySyncId?: string;
  type: TxType;
  amount: number;            // VŽDY kladná (znaménko je v type)
  signedAmount: number;      // negative = expense, positive = income (jak server pošle)
  currency: string;
  description: string;
  merchant?: string;
  date: string;              // YYYY-MM-DD
}

export function computeTxType(t: ServerTransaction): TxType {
  if (t.isTransfer) return "TRANSFER";
  const n = parseFloat(t.amount);
  return n < 0 ? "EXPENSE" : "INCOME";
}

export function toUiTransaction(syncId: string, t: ServerTransaction): UiTransaction {
  const signed = parseFloat(t.amount) || 0;
  return {
    syncId,
    profileId: t.profileId,
    accountSyncId: t.accountId,
    categorySyncId: t.categoryId,
    type: computeTxType(t),
    amount: Math.abs(signed),
    signedAmount: signed,
    currency: t.currency,
    description: t.description ?? t.merchant ?? "",
    merchant: t.merchant,
    date: t.date,
  };
}

/** Spočítá živý zůstatek účtu na základě initialBalance + součet transakcí na účtu. */
export function computeAccountBalance(
  account: ServerAccount,
  transactions: Array<{ data: ServerTransaction }>,
  accountSyncId: string,
): number {
  const initial = parseFloat(account.initialBalance) || 0;
  let sum = 0;
  for (const tx of transactions) {
    if (tx.data.accountId !== accountSyncId) continue;
    sum += parseFloat(tx.data.amount) || 0;
  }
  return initial + sum;
}
