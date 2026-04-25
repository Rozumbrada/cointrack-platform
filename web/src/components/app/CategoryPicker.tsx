"use client";

import { useMemo } from "react";
import { ServerCategory } from "@/lib/sync-types";
import { CategoryIcon, colorFromInt } from "./CategoryIcon";

export function CategoryPicker({
  allCategories,
  currentSyncId,
  txType,
  onSelect,
  onClose,
}: {
  allCategories: Array<{ syncId: string; data: ServerCategory }>;
  currentSyncId?: string;
  txType: "INCOME" | "EXPENSE" | "TRANSFER";
  onSelect: (syncId: string | null) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    if (txType === "TRANSFER") return [];
    // Kategorie se nefiltrují podle typu — stejná kategorie může pokrýt
    // jak příjem tak výdaj. Primární typ (badge) je pouze label.
    return [...allCategories].sort((a, b) => a.data.name.localeCompare(b.data.name));
  }, [allCategories, txType]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-2 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-2">
          <h2 className="text-lg font-semibold text-ink-900">Vyber kategorii</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-1">
          <button
            onClick={() => onSelect(null)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-50 ${
              currentSyncId == null ? "bg-brand-50" : ""
            }`}
          >
            <div className="w-8 h-8 rounded-full grid place-items-center bg-ink-100 shrink-0">
              <span className="material-icons text-ink-500" style={{ fontSize: "18px" }}>
                block
              </span>
            </div>
            <div className="flex-1 text-left text-sm text-ink-700">Bez kategorie</div>
            {currentSyncId == null && (
              <span className="material-icons text-brand-600" style={{ fontSize: "18px" }}>
                check
              </span>
            )}
          </button>

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-500">
              {txType === "TRANSFER"
                ? "Převody nemají kategorii."
                : "Žádné kategorie tohoto typu. Vytvoř na stránce Kategorie."}
            </div>
          )}

          {filtered.map((c) => {
            const isSel = c.syncId === currentSyncId;
            return (
              <button
                key={c.syncId}
                onClick={() => onSelect(c.syncId)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-50 ${
                  isSel ? "bg-brand-50" : ""
                }`}
              >
                <div
                  className="w-8 h-8 rounded-full grid place-items-center shrink-0"
                  style={{ backgroundColor: colorFromInt(c.data.color) }}
                >
                  <CategoryIcon name={c.data.icon} size="sm" />
                </div>
                <div className="flex-1 text-left text-sm text-ink-900">{c.data.name}</div>
                {isSel && (
                  <span className="material-icons text-brand-600" style={{ fontSize: "18px" }}>
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
