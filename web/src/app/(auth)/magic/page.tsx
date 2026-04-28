"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { auth, ApiError } from "@/lib/api";
import { setAuth } from "@/lib/auth-store";

function MagicInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("auth.magic");
  const token = params.get("t");
  const next = params.get("next") || "/app/dashboard";

  const [state, setState] = useState<"exchanging" | "ok" | "error">("exchanging");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError(t("fail_no_token"));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await auth.magicExchange(token);
        if (cancelled) return;
        setAuth(res.accessToken, res.refreshToken, res.user);
        setState("ok");
        // Bezpečnostní validace: next path musí začínat "/" a nesmí být "//..."
        const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app/dashboard";
        setTimeout(() => router.replace(safeNext), 600);
      } catch (e) {
        if (cancelled) return;
        setState("error");
        if (e instanceof ApiError) setError(e.message);
        else setError(t("fail_default"));
      }
    })();
    return () => { cancelled = true; };
  }, [token, next, router, t]);

  if (state === "exchanging") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-brand-100 text-brand-600 flex items-center justify-center mb-4 animate-pulse">
          🔐
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">{t("exchanging_title")}</h1>
        <p className="text-ink-600 text-sm">{t("exchanging_subtitle")}</p>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-4">
          ✓
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">{t("ok_title")}</h1>
        <p className="text-ink-600 text-sm">{t("ok_redirect", { next })}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4">
        ✕
      </div>
      <h1 className="text-xl font-semibold text-ink-900 mb-2">{t("fail_title")}</h1>
      <p className="text-ink-600 text-sm mb-6">{error}</p>
      <Link
        href="/login"
        className="inline-block h-11 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium leading-[2.75rem]"
      >
        {t("manual_signin")}
      </Link>
    </div>
  );
}

export default function MagicPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-600">…</div>}>
      <MagicInner />
    </Suspense>
  );
}
