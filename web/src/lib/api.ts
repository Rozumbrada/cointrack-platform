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
  register: (email: string, password: string, displayName?: string) =>
    api<UserDto>("/api/v1/auth/register", {
      method: "POST",
      body: { email, password, displayName },
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
};
