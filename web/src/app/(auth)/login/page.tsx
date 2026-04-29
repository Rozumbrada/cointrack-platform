"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { auth, ApiError } from "@/lib/api";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("auth.login");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await auth.login(email, password);
      if (typeof window !== "undefined") {
        localStorage.setItem("accessToken", res.accessToken);
        localStorage.setItem("refreshToken", res.refreshToken);
      }
      // Po loginu redirect zpět na ?next=... (např. /accept-share)
      // Bezpečnostní validace: musí začínat "/" a nesmí být "//..."
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app/profiles";
      router.push(safeNext);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(tc("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-1">{t("title")}</h1>
      <p className="text-ink-600 text-sm mb-6">{t("subtitle")}</p>

      <form onSubmit={onSubmit} className="space-y-4">
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
            placeholder={t("email_placeholder")}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <div className="flex justify-between items-baseline mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-ink-900">
              {tc("password")}
            </label>
            <Link href="/forgot" className="text-sm text-brand-600 hover:text-brand-700">
              {t("forgot_link")}
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder={t("password_placeholder")}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? tc("loading") : t("submit")}
        </Button>
      </form>

      <p className="text-center text-sm text-ink-600 mt-6">
        {t("no_account")}{" "}
        <Link
          href={params.get("next") ? `/signup?next=${encodeURIComponent(params.get("next") ?? "")}` : "/signup"}
          className="text-brand-600 hover:text-brand-700 font-medium"
        >
          {t("signup_link")}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-600">…</div>}>
      <LoginInner />
    </Suspense>
  );
}
