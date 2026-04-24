"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface ShoppingListData {
  id?: number;
  name: string;
  isArchived?: boolean;
  profileId?: number;
}

interface ShoppingItemData {
  id?: number;
  listId: number;
  name: string;
  quantity?: number;
  unit?: string;
  isChecked?: boolean;
  priceEstimate?: number;
}

export default function ShoppingPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const lists = entitiesByProfile<ShoppingListData>("shopping_lists");
  const items = entitiesByProfile<ShoppingItemData>("shopping_items");

  const itemsByList = useMemo(() => {
    const m = new Map<number, ShoppingItemData[]>();
    items.forEach((i) => {
      if (i.data.listId == null) return;
      const arr = m.get(i.data.listId) ?? [];
      arr.push(i.data);
      m.set(i.data.listId, arr);
    });
    return m;
  }, [items]);

  const active = useMemo(
    () => lists.filter((l) => !l.data.isArchived),
    [lists],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Nákupní seznamy</h1>
        <p className="text-sm text-ink-600 mt-1">
          Seznamy pro nakupování — z mobilu.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : active.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🛒</div>
          <div className="font-medium text-ink-900">Žádné seznamy</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {active.map((l) => {
            const lItems = l.data.id != null ? itemsByList.get(l.data.id) ?? [] : [];
            const checked = lItems.filter((i) => i.isChecked).length;
            return (
              <section
                key={l.syncId}
                className="bg-white rounded-2xl border border-ink-200 overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
                  <h2 className="font-semibold text-ink-900">{l.data.name}</h2>
                  <div className="text-xs text-ink-500">
                    {checked} / {lItems.length}
                  </div>
                </div>
                {lItems.length === 0 ? (
                  <div className="px-5 py-6 text-center text-ink-500 text-sm">
                    Prázdný seznam
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {lItems.map((it, idx) => (
                      <li
                        key={it.id ?? idx}
                        className={`px-5 py-2 flex items-center gap-3 text-sm ${
                          it.isChecked ? "text-ink-500 line-through" : "text-ink-900"
                        }`}
                      >
                        <span>{it.isChecked ? "☑" : "☐"}</span>
                        <div className="flex-1 min-w-0 truncate">{it.name}</div>
                        {it.quantity != null && (
                          <div className="text-xs text-ink-500">
                            {it.quantity}
                            {it.unit ? ` ${it.unit}` : ""}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
