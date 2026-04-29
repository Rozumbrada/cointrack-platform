/**
 * Tenký wrapper nad fetch. Mluví s Ktor backendem.
 * Používá NEXT_PUBLIC_API_URL z env proměnných.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, token } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? "unknown_error",
      data?.message ?? `HTTP ${res.status}`,
      data?.requestId,
    );
  }

  return data as T;
}

// Type-safe auth endpoints
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserDto;
}

export interface UserDto {
  id: string;
  email: string;
  displayName?: string;
  locale: string;
  tier: string;
  emailVerified: boolean;
}

export const auth = {
  register: (email: string, password: string, displayName?: string, locale?: string) =>
    api<UserDto>("/api/v1/auth/register", {
      method: "POST",
      body: { email, password, displayName, locale },
    }),

  login: (email: string, password: string) =>
    api<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  refresh: (refreshToken: string) =>
    api<AuthResponse>("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    }),

  logout: (refreshToken: string) =>
    api<{ message: string }>("/api/v1/auth/logout", {
      method: "POST",
      body: { refreshToken },
    }),

  me: (token: string) => api<UserDto>("/api/v1/auth/me", { token }),

  updateMe: (token: string, body: { locale?: string; displayName?: string }) =>
    api<UserDto>("/api/v1/auth/me", { method: "PATCH", token, body }),

  verifyEmail: (token: string) =>
    api<{ message: string }>("/api/v1/auth/verify-email", {
      method: "POST",
      body: { token },
    }),

  forgotPassword: (email: string) =>
    api<{ message: string }>("/api/v1/auth/forgot-password", {
      method: "POST",
      body: { email },
    }),

  resetPassword: (token: string, newPassword: string) =>
    api<{ message: string }>("/api/v1/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
    }),

  /** Vymění magic-link token za plnohodnotný JWT pair. Public endpoint. */
  magicExchange: (token: string) =>
    api<AuthResponse>("/api/v1/auth/magic-exchange", {
      method: "POST",
      body: { token },
    }),
};

// ─── GDPR (data export + account deletion) ──────────────────────────
export interface DeletionStatusDto {
  requestedAt?: string | null;
  deleteAfterAt?: string | null;
  canCancel: boolean;
}

export const gdpr = {
  /** GET /gdpr/export — vrací JSON, ale endpoint vrací attachment header.
   *  Voláme přes raw fetch ať dostaneme blob a stáhneme. */
  exportDownloadUrl: () => `${API_URL}/api/v1/gdpr/export`,

  deletionStatus: (token: string) =>
    api<DeletionStatusDto>("/api/v1/gdpr/delete", { token }),

  requestDeletion: (token: string) =>
    api<DeletionStatusDto>("/api/v1/gdpr/delete", { method: "POST", token }),

  cancelDeletion: (token: string) =>
    api<{ message: string }>("/api/v1/gdpr/delete", { method: "DELETE", token }),
};

// ─── Per-account sharing (V21) ───────────────────────────────────────
export interface AccountShareDto {
  id: string;
  accountId: string;
  email: string;
  role: string;            // VIEWER | EDITOR
  status: string;          // pending | active | revoked
  acceptedAt?: string | null;
  createdAt: string;
  userDisplayName?: string | null;
}

export interface AccountSharePreviewDto {
  ownerEmail: string;
  accountName: string;
  profileName: string;
  role: string;
  expiresAt?: string | null;
}

export interface SharedAccountInfoDto {
  accountId: string;
  name: string;
  currency: string;
  profileId: string;
  profileName: string;
}

export interface ShareWithAccountDto {
  id: string;
  accountId: string;
  accountSyncId: string;
  accountName: string;
  accountCurrency: string;
  profileSyncId: string;
  profileName: string;
  email: string;
  role: string;
  status: string;
  acceptedAt?: string | null;
  createdAt: string;
  userDisplayName?: string | null;
  visibilityIncome: boolean;
  visibilityExpenses: boolean;
  /** Whitelist syncId kategorií. null = bez omezení, [] = nic. */
  visibilityCategories: string[] | null;
}

export interface VisibilityFilter {
  visibilityIncome?: boolean;
  visibilityExpenses?: boolean;
  visibilityCategories?: string[] | null;
}

export const accountShares = {
  invite: (
    token: string,
    accountId: string,
    email: string,
    role: "VIEWER" | "EDITOR" | "ACCOUNTANT" = "VIEWER",
    visibility?: VisibilityFilter,
  ) =>
    api<AccountShareDto>(`/api/v1/accounts/${accountId}/shares`, {
      method: "POST",
      token,
      body: {
        email,
        role,
        visibilityIncome: visibility?.visibilityIncome ?? true,
        visibilityExpenses: visibility?.visibilityExpenses ?? true,
        visibilityCategories: visibility?.visibilityCategories ?? null,
      },
    }),

  list: (token: string, accountId: string) =>
    api<AccountShareDto[]>(`/api/v1/accounts/${accountId}/shares`, { token }),

  revoke: (token: string, shareId: string) =>
    api<{ ok: boolean }>(`/api/v1/accounts/shares/${shareId}`, {
      method: "DELETE", token,
    }),

  updateRole: (
    token: string,
    shareId: string,
    role: "VIEWER" | "EDITOR" | "ACCOUNTANT",
  ) =>
    api<AccountShareDto>(`/api/v1/accounts/shares/${shareId}`, {
      method: "PATCH", token, body: { role },
    }),

  updateShare: (
    token: string,
    shareId: string,
    update: {
      role?: "VIEWER" | "EDITOR" | "ACCOUNTANT";
      visibilityIncome?: boolean;
      visibilityExpenses?: boolean;
      visibilityCategories?: string[] | null;
      resetVisibilityCategories?: boolean;
    },
  ) =>
    api<AccountShareDto>(`/api/v1/accounts/shares/${shareId}`, {
      method: "PATCH", token, body: update,
    }),

  preview: (shareToken: string) =>
    api<AccountSharePreviewDto>(`/api/v1/accounts/shares/preview?token=${encodeURIComponent(shareToken)}`),

  accept: (token: string, shareToken: string) =>
    api<AccountShareDto>(`/api/v1/accounts/shares/accept`, {
      method: "POST", token, body: { token: shareToken },
    }),

  myShares: (token: string) =>
    api<SharedAccountInfoDto[]>(`/api/v1/accounts/shares/mine`, { token }),

  listOwned: (token: string) =>
    api<ShareWithAccountDto[]>(`/api/v1/accounts/shares/owned`, { token }),
};

// ─── iDoklad full proxy (V21) ───────────────────────────────────────
export interface IDokladInvoiceItemDto {
  name: string;
  quantity?: number;
  unitPrice: number;
  unitName?: string;
}

export interface CreateIDokladInvoiceRequest {
  profileId: string;
  partnerName: string;
  partnerEmail?: string;
  partnerStreet?: string;
  partnerCity?: string;
  partnerPostalCode?: string;
  partnerIco?: string;
  partnerDic?: string;
  dateOfIssue: string;     // YYYY-MM-DD
  dateOfMaturity: string;  // YYYY-MM-DD
  description?: string;
  note?: string;
  variableSymbol?: string;
  currencyCode?: string;
  items: IDokladInvoiceItemDto[];
}

export interface CreateIDokladInvoiceResponse {
  idokladId: string;
  invoiceNumber: string | null;
  totalWithVat: string;
  cointrackInvoiceSyncId: string;
}

export const idoklad = {
  createInvoice: (token: string, req: CreateIDokladInvoiceRequest) =>
    api<CreateIDokladInvoiceResponse>("/api/v1/idoklad/invoices", {
      method: "POST", token, body: req,
    }),

  markPaid: (token: string, profileId: string, idokladId: string, date?: string) =>
    api<{ ok: boolean }>(
      `/api/v1/idoklad/profiles/${profileId}/invoices/${idokladId}/mark-paid${date ? `?date=${date}` : ""}`,
      { method: "POST", token },
    ),

  pdfUrl: (profileId: string, idokladId: string) =>
    `${API_URL}/api/v1/idoklad/profiles/${profileId}/invoices/${idokladId}/pdf`,

  sendEmail: (token: string, profileId: string, idokladId: string, to?: string) =>
    api<{ ok: boolean }>(
      `/api/v1/idoklad/profiles/${profileId}/invoices/${idokladId}/send-email${to ? `?to=${encodeURIComponent(to)}` : ""}`,
      { method: "POST", token },
    ),
};

// ─── Sync pull (seznam všech entit) ─────────────────────────────────
export interface SyncEntity {
  syncId: string;
  updatedAt: string;
  deletedAt?: string | null;
  clientVersion: number;
  data: Record<string, unknown>;
}

export interface SyncPullResponse {
  serverTime: string;
  entities: Record<string, SyncEntity[]>;
}

export interface SyncPushRequest {
  entities: Record<string, SyncEntity[]>;
}

export interface SyncPushResponse {
  accepted: Record<string, string[]>;
  conflicts: Record<string, SyncEntity[]>;
}

export const sync = {
  pull: (token: string, since?: string) =>
    api<SyncPullResponse>(
      `/api/v1/sync${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      { token },
    ),

  push: (token: string, req: SyncPushRequest) =>
    api<SyncPushResponse>("/api/v1/sync", { method: "POST", token, body: req }),
};

// ─── Banking (Sprint 6 Salt Edge) ───────────────────────────────────
export interface BankAccountExtDto {
  id: string;
  name?: string;
  nature?: string;
  currencyCode: string;
  iban?: string;
  accountNumber?: string;
  balance?: string;
  balanceUpdatedAt?: string;
  /** Profile syncIds, ke kterým je účet přiřazen. */
  assignedProfileIds?: string[];
  autoImportProfileIds?: string[];
}

export interface BankAssignmentDto {
  id: string;
  bankAccountExtId: string;
  profileId: string;
  autoImport: boolean;
  createdAt: string;
}

export interface BankConnectionDto {
  id: string;
  providerCode?: string;
  providerName?: string;
  status: string;
  lastSuccessAt?: string;
  consentExpiresAt?: string;
  lastError?: string;
  accounts: BankAccountExtDto[];
}

export interface BankTransactionExtDto {
  id: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  description?: string;
  madeOn: string;
  merchantName?: string;
  status: string;
}

export const bank = {
  listConnections: (token: string) =>
    api<{ connections: BankConnectionDto[] }>("/api/v1/bank/connections", { token }),

  connect: (token: string, providerCode?: string, locale = "cs") =>
    api<{ connectUrl: string; expiresAt: string }>("/api/v1/bank/connect", {
      method: "POST",
      token,
      body: { providerCode, locale },
    }),

  delete: (token: string, id: string) =>
    api<void>(`/api/v1/bank/connections/${id}`, { method: "DELETE", token }),

  reconnect: (token: string, id: string, locale = "cs") =>
    api<{ connectUrl: string; expiresAt: string }>(
      `/api/v1/bank/connections/${id}/reconnect?locale=${locale}`,
      { method: "POST", token },
    ),

  listTransactions: (token: string, accountId: string, limit = 100) =>
    api<{ transactions: BankTransactionExtDto[] }>(
      `/api/v1/bank/accounts/${accountId}/transactions?limit=${limit}`,
      { token },
    ),

  // ─── Sprint 8 — assignment ─────────────────────────────────────
  listAssignments: (token: string) =>
    api<{ assignments: BankAssignmentDto[] }>("/api/v1/bank/assignments", { token }),

  assignToProfile: (token: string, accountId: string, profileId: string, autoImport = false) =>
    api<BankAssignmentDto>(`/api/v1/bank/accounts/${accountId}/assign-to-profile`, {
      method: "POST",
      token,
      body: { profileId, autoImport },
    }),

  unassignFromProfile: (token: string, accountId: string, profileId: string) =>
    api<void>(`/api/v1/bank/accounts/${accountId}/assignment/${profileId}`, {
      method: "DELETE",
      token,
    }),
};
