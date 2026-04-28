"use server";

import { cookies } from "next/headers";
import { isSupportedLocale } from "@/i18n/request";

const COOKIE_NAME = "cointrack-locale";

/** Server action — uloží locale do cookie a obnoví stránku. */
export async function setLocaleAction(locale: string) {
  if (!isSupportedLocale(locale)) return;
  const c = await cookies();
  c.set(COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 rok
    sameSite: "lax",
  });
}
