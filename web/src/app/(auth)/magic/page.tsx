"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, ApiError } from "@/lib/api";
import { setAuth } from "@/lib/auth-store";

function MagicInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("t");
  const next = params.get("next") || "/app/dashboard";

  const [state, setState] = useState<"exchanging" | "ok" | "error">("exchanging");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Chybí magic token v URL.");
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
        // Drobná pauza, ať user vidí "Přihlášen"
        setTimeout(() => router.replace(safeNext), 600);
      } catch (e) {
        if (cancelled) return;
        setState("error");
        if (e instanceof ApiError) setError(e.message);
        else setError("Magic link nelze ověřit. Možná expiroval (5 min platnost) nebo už byl použit.");
      }
    })();
    return () => { cancelled = true; };
  }, [token, next, router]);

  if (state === "exchanging") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-brand-100 text-brand-600 flex items-center justify-center mb-4 animate-pulse">
          🔐
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Přihlašuji…</h1>
        <p className="text-ink-600 text-sm">Auto-login z mobilní aplikace.</p>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-4">
          ✓
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Přihlášen</h1>
        <p className="text-ink-600 text-sm">Pokračuji na {next}…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4">
        ✕
      </div>
      <h1 className="text-xl font-semibold text-ink-900 mb-2">Auto-login selhal</h1>
      <p className="text-ink-600 text-sm mb-6">{error}</p>
      <Link
        href="/login"
        className="inline-block h-11 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium leading-[2.75rem]"
      >
        Přihlásit se manuálně
      </Link>
    </div>
  );
}

export default function MagicPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-600">Načítám…</div>}>
      <MagicInner />
    </Suspense>
  );
}
