"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { auth, ApiError } from "@/lib/api";
import { setAuth, setStoredUser, getAccessToken } from "@/lib/auth-store";

function SignupInner() {
  const t = useTranslations("auth.signup");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const loginHref = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [verifiedDetected, setVerifiedDetected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("password_too_short"));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("password_mismatch"));
      return;
    }
    setLoading(true);
    try {
      // Pošleme `next` (např. /accept-share?token=...) na server, ten ji vloží
      // do verify URL → po kliknutí na verify e-mail link uživatele dostaneme
      // přes login zpět na původní cestu (zachovaný kontext share invitation).
      const res = await auth.register(email, password, displayName || undefined, locale, safeNext ?? undefined);
      // Server nově vrací AuthResponse — máme rovnou access+refresh tokeny.
      // Uložíme je → user je v lokálním state přihlášený, jen čeká na ověření.
      setAuth(res.accessToken, res.refreshToken, res.user);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(t("register_failed"));
    } finally {
      setLoading(false);
    }
  }

  // Polling po registraci: každé 3s zkontroluj přes auth.me() jestli už user
  // potvrdil e-mail (klikl na verify link v jiném taby/emailu). Jakmile
  // emailVerified=true, redirect na safeNext (typicky /accept-share?token=...)
  // nebo /app/dashboard.
  useEffect(() => {
    if (!done || verifiedDetected) return;
    let cancelled = false;
    async function tick() {
      const token = getAccessToken();
      if (!token) return;
      try {
        const me = await auth.me(token);
        if (cancelled) return;
        if (me.emailVerified) {
          setVerifiedDetected(true);
          if (pollRef.current) clearInterval(pollRef.current);
          // Aktualizuj uloženého user objektu — propaguje verified=true do
          // všech komponent čtoucích přes getStoredUser().
          setStoredUser(me);
          // Redirect — přednost má `next` param (typicky /accept-share?token=...)
          router.replace(safeNext ?? "/app/dashboard");
        }
      } catch {
        // Síťová chyba / 401 — pokračujeme v pollingu, user může re-loginovat.
      }
    }
    // První tick okamžitě, pak každé 3s.
    tick();
    pollRef.current = setInterval(tick, 3_000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [done, verifiedDetected, router, safeNext]);

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mb-4 animate-pulse">
          ✉️
        </div>
        <h1 className="text-2xl font-semibold text-ink-900 mb-2">{t("almost_done")}</h1>
        <p className="text-ink-600 mb-6">
          {t("verify_sent", { email })}
        </p>
        <p className="text-xs text-ink-500 mb-6">
          {/* Tahle stránka se sama přesměruje, jakmile klikneš na ověřovací odkaz v e-mailu.
              Můžeš ho otevřít v novém panelu — tato karta to detekuje. */}
          Tato stránka se automaticky přesměruje, jakmile potvrdíš e-mail (sleduje se každé 3s).
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href={loginHref}>{t("login_link")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-1">{t("title")}</h1>
      <p className="text-ink-600 text-sm mb-6">{t("subtitle")}</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink-900 mb-1.5">
            {t("display_name")} <span className="text-ink-400 font-normal">{t("display_name_optional")}</span>
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-900 mb-1.5">
            {tc("email")}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-900 mb-1.5">
            {tc("password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <p className="text-xs text-ink-500 mt-1">{t("password_min")}</p>
        </div>
        <div>
          <label htmlFor="passwordConfirm" className="block text-sm font-medium text-ink-900 mb-1.5">
            {t("password_confirm")}
          </label>
          <input
            id="passwordConfirm"
            type="password"
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            minLength={8}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          {passwordConfirm.length > 0 && passwordConfirm !== password && (
            <p className="text-xs text-red-600 mt-1">{t("password_mismatch")}</p>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? t("creating") : t("submit")}
        </Button>

        <p className="text-xs text-ink-500 text-center">
          {t("terms_agreement")}{" "}
          <Link href="/terms" className="text-brand-600 hover:text-brand-700">
            {t("terms_link")}
          </Link>{" "}
          {t("and")}{" "}
          <Link href="/privacy" className="text-brand-600 hover:text-brand-700">
            {t("privacy_link")}
          </Link>
          .
        </p>
      </form>

      <p className="text-center text-sm text-ink-600 mt-6">
        {t("have_account")}{" "}
        <Link href={loginHref} className="text-brand-600 hover:text-brand-700 font-medium">
          {t("login_link")}
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-600">…</div>}>
      <SignupInner />
    </Suspense>
  );
}
