"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/lib/locale-action";

/**
 * Jednoduchý CS/EN přepínač. Po změně uloží locale do cookie (server action)
 * a obnoví stránku, aby se znovu načetly server-side strings.
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === current) return;
    startTransition(async () => {
      await setLocaleAction(next);
      window.location.reload();
    });
  }

  return (
    <div className={`inline-flex rounded-lg border border-ink-300 bg-white overflow-hidden text-xs ${className}`}>
      {(["cs", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => change(l)}
          disabled={pending}
          className={`px-2.5 py-1 uppercase font-medium ${
            current === l ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50"
          } disabled:opacity-50`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
