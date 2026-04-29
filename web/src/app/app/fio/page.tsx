"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /app/fio routa — celé Fio UI bylo přesunuto inline do /app/banks
 * ("Bankovní spojení") jako <FioConnectionCard />. Tahle stránka existuje
 * už jen pro backward-compat redirect — staré bookmarky / odkazy z e-mailů
 * tak skončí na správném místě.
 */
export default function FioRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/banks#fio");
  }, [router]);
  return (
    <div className="py-20 text-center text-ink-500 text-sm">
      Přesměrování do „Bankovní spojení"…
    </div>
  );
}
