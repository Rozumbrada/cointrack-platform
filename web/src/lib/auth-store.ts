/**
 * Client-side auth store. Persistuje access/refresh token v localStorage
 * (dev) a auto-refreshuje access token když expiruje.
 *
 * TODO (prod hardening): přesunout tokeny do httpOnly cookies přes Next.js
 * API routes (/api/session), aby se zabránilo XSS útokům.
 */

"use client";

import { auth as authApi, UserDto, ApiError } from "./api";

const ACCESS_KEY = "cointrack_accessToken";
const REFRESH_KEY = "cointrack_refreshToken";
const USER_KEY = "cointrack_user";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY) ?? localStorage.getItem("accessToken");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY) ?? localStorage.getItem("refreshToken");
}

export function getStoredUser(): UserDto | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserDto;
  } catch {
    return null;
  }
}

export function setAuth(accessToken: string, refreshToken: string, user: UserDto) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Kompatibilita se stávající login stránkou
  localStorage.setItem("accessToken", accessToken);
  localStorage.setItem("refreshToken", refreshToken);
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
}

/**
 * Zavolá daný endpoint. Pokud 401, pokusí se jednou refresh + retry.
 * Pokud refresh selže, vyhodí auth chybu — volající by měl uživatele odhlásit.
 */
export async function withAuth<T>(
  call: (token: string) => Promise<T>,
): Promise<T> {
  let token = getAccessToken();
  if (!token) throw new ApiError(401, "no_token", "Nejsi přihlášen.");

  try {
    return await call(token);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const refresh = getRefreshToken();
      if (!refresh) {
        clearAuth();
        throw e;
      }
      try {
        const res = await authApi.refresh(refresh);
        setAuth(res.accessToken, res.refreshToken, res.user);
        token = res.accessToken;
        return await call(token);
      } catch (refreshErr) {
        clearAuth();
        throw refreshErr;
      }
    }
    throw e;
  }
}
