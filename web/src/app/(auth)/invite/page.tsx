"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Sprint 5e — Invite landing page.
 *
 * Tok:
 *  1. Uzivatel klikne na link v e-mailu: https://cointrack.cz/invite?token=xxx
 *  2. Tato stranka se pokusi otevrit mobilni app pres deep link
 *     cointrack://accept-invite?token=xxx
 *  3. Pokud app neni nainstalovana, tlacitko vede na Play Store.
 *  4. Alternativne user muze manualne vlozit token v app -> Nastaveni -> Cloud -> Pozvanky.
 */

function InviteContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Auto-redirect pokusem o otevreni aplikace
    const deepLink = `cointrack://accept-invite?token=${encodeURIComponent(token)}`;
    window.location.href = deepLink;
    const t = setTimeout(() => setAttempted(true), 1500);
    return () => clearTimeout(t);
  }, [token]);

  if (!token) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Chybná pozvánka</h1>
        <p className="text-ink-600 mb-6">
          Odkaz neobsahuje platný token. Zkontroluj e-mail s pozvánkou.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Na hlavní stránku</Link>
        </Button>
      </div>
    );
  }

  const deepLink = `cointrack://accept-invite?token=${encodeURIComponent(token)}`;
  const playStoreUrl = "https://play.google.com/store/apps/details?id=cz.wallet.finance";

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-2">Pozvánka do organizace</h1>
      <p className="text-ink-600 mb-6">
        Byl jsi pozván do organizace v Cointracku. Pro přijetí otevři pozvánku v mobilní aplikaci.
      </p>

      <div className="space-y-3">
        <Button asChild variant="brand" className="w-full">
          <a href={deepLink}>Otevřít v aplikaci</a>
        </Button>

        {attempted && (
          <div className="rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 text-sm text-ink-700">
            <p className="font-medium mb-1">Nemáš aplikaci?</p>
            <p className="mb-3">
              Stáhni Cointrack a přihlaš se e-mailem, na který byla pozvánka zaslána.
              Pozvánka bude čekat 14 dní.
            </p>
            <Button asChild variant="outline" className="w-full">
              <a href={playStoreUrl} target="_blank" rel="noopener noreferrer">
                Stáhnout z Google Play
              </a>
            </Button>
          </div>
        )}

        <details className="text-sm text-ink-500">
          <summary className="cursor-pointer">Nejde to otevřít?</summary>
          <p className="mt-2">
            Spusť aplikaci → <strong>Cloud</strong> → <strong>Organizace</strong> → menu „Přijmout pozvánku"
            a vlož tento token:
          </p>
          <code className="mt-2 block bg-ink-50 border border-ink-200 rounded p-2 text-xs break-all">
            {token}
          </code>
        </details>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="text-center text-ink-500">Načítám…</div>}>
      <InviteContent />
    </Suspense>
  );
}
