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

/** V30 — origin tracking pro faktury (manual / scan / idoklad / email). */
export type InvoiceSource = "manual" | "scan" | "idoklad" | "email";

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
  /** Legacy alias pro auto-importované účty (Salt Edge). Server posílá `bankProvider`,
      mobile starší verze ukládali jako `externalProvider`. UI používá oba. */
  externalProvider?: string;
  bankIban?: string;
  /** Číslo účtu bez kódu banky (např. "0000192000145399"). Pro Pohoda XML export. */
  bankAccountNumber?: string;
  /** Kód banky (např. "0100" pro KB). Pro Pohoda XML export. */
  bankCode?: string;
  /** Pohoda Banky → Zkratka (typ:ids). Pro Pohoda XML export. */
  pohodaShortcut?: string;
  /** Salt Edge profile assignment — array syncId profilů ke kterým účet patří. */
  assignedProfileIds?: string[];
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

/**
 * Vrátí živý zůstatek účtu.
 *
 * **Důležitá historie**: `ServerAccount.initialBalance` je deklarovaná jako
 * "počáteční zůstatek", ale Android klient ji ve skutečnosti vždy push-uje
 * jako `account.balance` (= live zůstatek po každé tx). Server tedy uchovává
 * `initial_balance ≈ klientův live balance v okamžiku posledního push účtu`.
 *
 * Sčítat k ní `sum(tx)` znamená dvojí započítání transakcí (jsou už zahrnuté
 * v initialBalance). Proto vracíme jen tu hodnotu — je konzistentní s tím,
 * co vidí mobil, a transakce v ní jsou už promítnuté.
 *
 * Parametry `transactions`/`accountSyncId` zůstávají v signatuře pro budoucí
 * čisté řešení (kotva + sum transakcí), aby volající strany nebylo třeba měnit.
 */
export function computeAccountBalance(
  account: ServerAccount,
  _transactions: Array<{ data: ServerTransaction }>,
  _accountSyncId: string,
): number {
  return parseFloat(account.initialBalance) || 0;
}
