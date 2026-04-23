"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth, ApiError } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
      await auth.register(email, password, displayName || undefined);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Registrace se nezdařila. Zkus to znovu.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-4">
          ✓
        </div>
        <h1 className="text-2xl font-semibold text-ink-900 mb-2">Téměř hotovo</h1>
        <p className="text-ink-600 mb-6">
          Poslali jsme ti ověřovací email na <strong>{email}</strong>. Klikni na odkaz
          a můžeš se přihlásit.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Přihlásit se</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-1">Vytvořit účet</h1>
      <p className="text-ink-600 text-sm mb-6">14 dní zdarma. Bez karty.</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink-900 mb-1.5">
            Jméno <span className="text-ink-400 font-normal">(volitelné)</span>
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
            Email
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
            Heslo
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
          <p className="text-xs text-ink-500 mt-1">Aspoň 8 znaků.</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? "Zakládám účet…" : "Zaregistrovat"}
        </Button>

        <p className="text-xs text-ink-500 text-center">
          Registrací souhlasíš s{" "}
          <Link href="/terms" className="text-brand-600 hover:text-brand-700">
            podmínkami
          </Link>{" "}
          a{" "}
          <Link href="/privacy" className="text-brand-600 hover:text-brand-700">
            zpracováním osobních údajů
          </Link>
          .
        </p>
      </form>

      <p className="text-center text-sm text-ink-600 mt-6">
        Už máš účet?{" "}
        <Link href="/login" className="text-brand-600 hover:text-brand-700 font-medium">
          Přihlásit
        </Link>
      </p>
    </div>
  );
}
