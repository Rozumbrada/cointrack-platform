import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const SUPPORTED_LOCALES = ["cs", "en"] as const;
export const DEFAULT_LOCALE = "cs";
export const COOKIE_NAME = "cointrack-locale";

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(v: string | undefined): v is Locale {
  return v != null && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/**
 * Detekce locale: explicitní cookie > Accept-Language > default (cs).
 * Pokud Accept-Language vrátí např. "en-US,en;q=0.9", bereme prefix.
 */
async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(COOKIE_NAME)?.value;
  if (isSupportedLocale(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get("accept-language");
  if (accept) {
    const primary = accept.split(",")[0]?.split("-")[0]?.trim().toLowerCase();
    if (isSupportedLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
