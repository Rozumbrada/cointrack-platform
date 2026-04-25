"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentDialog } from "./DocumentDialog";

/**
 * Plovoucí + tlačítko vpravo dole, klik rozbalí 3 akce
 * (totéž co mobilní home screen FAB).
 */
export function QuickActionFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docMode, setDocMode] = useState<"scan" | "upload" | null>(null);

  // Zavřít speed-dial při Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="fixed bottom-6 right-72 z-40 flex flex-col items-end gap-3">
        {open && (
          <>
            <FabAction
              label="Skenovat doklad"
              icon="📷"
              onClick={() => {
                setOpen(false);
                setDocMode("scan");
              }}
              color="bg-emerald-600 hover:bg-emerald-700"
            />
            <FabAction
              label="Nahrát doklad"
              icon="📄"
              onClick={() => {
                setOpen(false);
                setDocMode("upload");
              }}
              color="bg-amber-600 hover:bg-amber-700"
            />
            <FabAction
              label="Ručně přidat platbu"
              icon="✏️"
              onClick={() => {
                setOpen(false);
                router.push("/app/transactions/new");
              }}
              color="bg-brand-600 hover:bg-brand-700"
            />
          </>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-3xl shadow-lg grid place-items-center transition-transform ${
            open ? "rotate-45" : ""
          }`}
          aria-label={open ? "Zavřít menu" : "Rychlé akce"}
        >
          +
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/10"
          onClick={() => setOpen(false)}
        />
      )}

      {docMode && (
        <DocumentDialog mode={docMode} onClose={() => setDocMode(null)} />
      )}
    </>
  );
}

function FabAction({
  label,
  icon,
  onClick,
  color,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-ink-900 text-white text-sm rounded-lg px-3 py-1.5 shadow-md whitespace-nowrap">
        {label}
      </span>
      <button
        onClick={onClick}
        className={`w-12 h-12 rounded-full ${color} text-white text-xl shadow-lg grid place-items-center`}
      >
        {icon}
      </button>
    </div>
  );
}
