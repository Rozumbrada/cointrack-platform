"use client";

import { useMemo, useState } from "react";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface ShoppingListData {
  profileId: string;
  name: string;
  color: number;
}

interface ShoppingItemData {
  listId: string;
  name: string;
  /** server posílá string */
  quantity: string;
  price?: string;
  isChecked: boolean;
}

type ListRow = { syncId: string; data: ShoppingListData };
type ItemRow = { syncId: string; data: ShoppingItemData };

export default function ShoppingPage() {
  const { loading, error, entitiesByProfile, rawEntities, profileSyncId, reload } = useSyncData();
  const lists = entitiesByProfile<ShoppingListData>("shopping_lists");
  const itemEntities = rawEntities("shopping_items");

  const [editingList, setEditingList] = useState<ListRow | "new" | null>(null);
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<ItemRow | null>(null);

  const itemsByList = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    itemEntities.forEach((e) => {
      const d = e.data as unknown as ShoppingItemData;
      if (!d.listId) return;
      const arr = m.get(d.listId) ?? [];
      arr.push({ syncId: e.syncId, data: d });
      m.set(d.listId, arr);
    });
    return m;
  }, [itemEntities]);

  async function pushList(syncId: string, data: ShoppingListData, deletedAt?: string) {
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          shopping_lists: [
            {
              syncId,
              updatedAt: now,
              deletedAt,
              clientVersion: 1,
              data: data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  async function pushItem(syncId: string, data: ShoppingItemData, deletedAt?: string) {
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          shopping_items: [
            {
              syncId,
              updatedAt: now,
              deletedAt,
              clientVersion: 1,
              data: data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  async function toggleItem(item: ItemRow) {
    await pushItem(item.syncId, { ...item.data, isChecked: !item.data.isChecked });
  }

  async function deleteList(list: ListRow) {
    if (!confirm(`Smazat seznam „${list.data.name}"? Smaže i položky.`)) return;
    const now = new Date().toISOString();
    await pushList(list.syncId, list.data, now);
  }

  async function deleteItem(item: ItemRow) {
    const now = new Date().toISOString();
    await pushItem(item.syncId, item.data, now);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Nákupní seznamy</h1>
          <p className="text-sm text-ink-600 mt-1">Klikni na položku pro přepnutí, hover pro úpravy.</p>
        </div>
        <button
          onClick={() => setEditingList("new")}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          + Nový seznam
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : lists.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🛒</div>
          <div className="font-medium text-ink-900">Žádné seznamy</div>
          <p className="text-sm text-ink-600 mt-2">Klikni na „Nový seznam".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lists.map((l) => {
            const lItems = itemsByList.get(l.syncId) ?? [];
            const checked = lItems.filter((i) => i.data.isChecked).length;
            return (
              <section key={l.syncId} className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
                <div
                  className="px-5 py-3 border-b border-ink-200 flex items-center justify-between gap-2 group"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: argbToCss(l.data.color),
                  }}
                >
                  <h2 className="font-semibold text-ink-900 truncate">{l.data.name}</h2>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-ink-500">
                      {checked} / {lItems.length}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                      <button onClick={() => setEditingList(l)} className="text-ink-500 hover:text-ink-700 px-1" title="Upravit">
                        ✏️
                      </button>
                      <button onClick={() => deleteList(l)} className="text-red-500 hover:text-red-700 px-1" title="Smazat">
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
                {lItems.length === 0 ? (
                  <div className="px-5 py-4 text-center text-ink-500 text-sm">Prázdný seznam</div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {lItems.map((it) => (
                      <li
                        key={it.syncId}
                        className="px-5 py-2 flex items-center gap-3 text-sm group hover:bg-ink-50/50"
                      >
                        <button
                          onClick={() => toggleItem(it)}
                          className="w-5 h-5 grid place-items-center"
                        >
                          {it.data.isChecked ? "☑" : "☐"}
                        </button>
                        <div
                          className={`flex-1 min-w-0 truncate ${it.data.isChecked ? "text-ink-500 line-through" : "text-ink-900"}`}
                        >
                          {it.data.name}
                        </div>
                        {it.data.quantity && it.data.quantity !== "1" && (
                          <div className="text-xs text-ink-500">{it.data.quantity}×</div>
                        )}
                        {it.data.price && (
                          <div className="text-xs text-ink-500 tabular-nums">
                            {fmt(parseFloat(it.data.price), "CZK")}
                          </div>
                        )}
                        <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                          <button onClick={() => setEditingItem(it)} className="text-ink-500 hover:text-ink-700 px-1" title="Upravit">
                            ✏️
                          </button>
                          <button onClick={() => deleteItem(it)} className="text-red-500 hover:text-red-700 px-1" title="Smazat">
                            🗑
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => setAddingItemTo(l.syncId)}
                  className="w-full px-5 py-2 text-sm text-brand-600 hover:bg-ink-50 border-t border-ink-100"
                >
                  + Položka
                </button>
              </section>
            );
          })}
        </div>
      )}

      {editingList && (
        <ListEditor
          initial={editingList === "new" ? null : editingList}
          profileSyncId={profileSyncId}
          onClose={() => setEditingList(null)}
          onSaved={async (data, syncId) => {
            await pushList(syncId, data);
            setEditingList(null);
          }}
        />
      )}

      {(addingItemTo || editingItem) && (
        <ItemEditor
          listSyncId={editingItem?.data.listId ?? addingItemTo!}
          initial={editingItem}
          onClose={() => {
            setAddingItemTo(null);
            setEditingItem(null);
          }}
          onSaved={async (data, syncId) => {
            await pushItem(syncId, data);
            setAddingItemTo(null);
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
}

function ListEditor({
  initial,
  profileSyncId,
  onClose,
  onSaved,
}: {
  initial: ListRow | null;
  profileSyncId: string | null;
  onClose: () => void;
  onSaved: (data: ShoppingListData, syncId: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.data.name ?? "");
  const [color, setColor] = useState<number>(initial?.data.color ?? 0xff3b82f6);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presetColors = [
    0xff3b82f6, 0xff10b981, 0xffef4444, 0xfff59e0b, 0xff8b5cf6, 0xffec4899, 0xff14b8a6, 0xff6b7280,
  ];

  async function save() {
    if (!profileSyncId) return setErr("Není vybraný profil.");
    if (!name.trim()) return setErr("Vyplň název.");
    setSaving(true);
    setErr(null);
    try {
      await onSaved(
        {
          profileId: profileSyncId,
          name: name.trim(),
          color,
        },
        initial?.syncId ?? crypto.randomUUID(),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? "Upravit seznam" : "Nový seznam"}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
    >
      <Field label="Název">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} />
      </Field>
      <Field label="Barva">
        <div className="flex flex-wrap gap-2">
          {presetColors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-9 h-9 rounded-lg border-2 ${color === c ? "border-ink-900" : "border-transparent"}`}
              style={{ backgroundColor: argbToCss(c) }}
            />
          ))}
        </div>
      </Field>
    </FormDialog>
  );
}

function ItemEditor({
  listSyncId,
  initial,
  onClose,
  onSaved,
}: {
  listSyncId: string;
  initial: ItemRow | null;
  onClose: () => void;
  onSaved: (data: ShoppingItemData, syncId: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.data.name ?? "");
  const [quantity, setQuantity] = useState(initial?.data.quantity ?? "1");
  const [price, setPrice] = useState(initial?.data.price ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setErr("Vyplň název.");
    setSaving(true);
    setErr(null);
    try {
      await onSaved(
        {
          listId: listSyncId,
          name: name.trim(),
          quantity: quantity || "1",
          price: price ? parseFloat(price.replace(",", ".")).toFixed(2) : undefined,
          isChecked: initial?.data.isChecked ?? false,
        },
        initial?.syncId ?? crypto.randomUUID(),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? "Upravit položku" : "Nová položka"}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
    >
      <Field label="Název">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Množství">
          <input type="text" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Cena (volitelná)">
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function argbToCss(c: number): string {
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r},${g},${b})`;
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
