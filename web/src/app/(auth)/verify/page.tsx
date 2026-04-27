"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth, ApiError } from "@/lib/api";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");

  const [state, setState] = useState<"verifying" | "ok" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Chybí ověřovací token v URL.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await auth.verifyEmail(token);
        if (!cancelled) setState("ok");
      } catch (e) {
        if (cancelled) return;
        setState("error");
        if (e instanceof ApiError) setError(e.message);
        else setError("Ověření selhalo. Zkus to znovu nebo požádej o nový odkaz.");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state === "verifying") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-brand-100 text-brand-600 flex items-center justify-center mb-4 animate-pulse">
          ⏳
        </div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Ověřuji email…</h1>
        <p className="text-ink-600 text-sm">Chvilku to trvá.</p>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-4">
          ✓
        </div>
        <h1 className="text-2xl font-semibold text-ink-900 mb-2">Email ověřen</h1>
        <p className="text-ink-600 mb-6">Účet je aktivován. Můžeš se přihlásit.</p>
        <Button asChild variant="brand" className="w-full">
          <Link href="/login">Přihlásit se</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4">
        ✕
      </div>
      <h1 className="text-2xl font-semibold text-ink-900 mb-2">Ověření selhalo</h1>
      <p className="text-ink-600 mb-6">{error}</p>
      <div className="space-y-2">
        <Button asChild variant="brand" className="w-full">
          <Link href="/login">Přejít na přihlášení</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/forgot">Požádat o nový odkaz</Link>
        </Button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl border border-ink-200 p-8 text-center text-ink-600">Načítám…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
