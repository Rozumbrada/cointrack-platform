"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth, ApiError } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Heslo musí mít aspoň 8 znaků.");
      return;
    }
    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Nepodařilo se nastavit nové heslo.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Chybný odkaz</h1>
        <p className="text-ink-600 mb-6">
          Odkaz pro obnovu hesla neobsahuje platný token.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/forgot">Požádat o nový odkaz</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Heslo změněno</h1>
        <p className="text-ink-600">Přesměrujeme tě na přihlášení…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-6">Nastavit nové heslo</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-900 mb-1.5">
            Nové heslo
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? "Ukládám…" : "Nastavit heslo"}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="text-center text-ink-500">Načítám…</div>}>
      <ResetForm />
    </Suspense>
  );
}
