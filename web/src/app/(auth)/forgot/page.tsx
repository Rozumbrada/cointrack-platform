"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/api";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await auth.forgotPassword(email);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <h1 className="text-2xl font-semibold text-ink-900 mb-2">Zkontroluj email</h1>
        <p className="text-ink-600 mb-6">
          Pokud je <strong>{email}</strong> zaregistrovaný, poslali jsme odkaz na obnovu hesla.
          Platí 1 hodinu.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Zpět na přihlášení</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-1">Zapomenuté heslo</h1>
      <p className="text-ink-600 text-sm mb-6">
        Zadej email a pošleme ti odkaz na nastavení nového hesla.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-900 mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? "Posílám…" : "Poslat odkaz"}
        </Button>
      </form>

      <p className="text-center text-sm text-ink-600 mt-6">
        <Link href="/login" className="text-brand-600 hover:text-brand-700">← Zpět</Link>
      </p>
    </div>
  );
}
