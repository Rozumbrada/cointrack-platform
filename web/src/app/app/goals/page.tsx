"use client";

import { useState } from "react";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface GoalData {
  profileId: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  color?: number;
  deadline?: string;
  note: string;
}

type GoalRow = { syncId: string; data: GoalData };

export default function GoalsPage() {
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const goals = entitiesByProfile<GoalData>("goals");
  const [editing, setEditing] = useState<GoalRow | "new" | null>(null);

  async function onDelete(row: GoalRow) {
    if (!confirm(`Smazat cíl "${row.data.name}"?`)) return;
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          goals: [
            {
              syncId: row.syncId,
              updatedAt: now,
              deletedAt: now,
              clientVersion: 1,
              data: row.data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Cíle</h1>
          <p className="text-sm text-ink-600 mt-1">
            Spořicí cíle — na dovolenou, na auto, rezervu…
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          + Nový cíl
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : goals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <div className="font-medium text-ink-900">Žádné cíle</div>
          <p className="text-sm text-ink-600 mt-2">Klikni na „Nový cíl".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => {
            const target = parseFloat(g.data.targetAmount) || 0;
            const current = parseFloat(g.data.currentAmount) || 0;
            const pct = Math.min(100, (current / Math.max(target, 1)) * 100);
            const done = current >= target;
            return (
              <div key={g.syncId} className="bg-white rounded-2xl border border-ink-200 p-5 group">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg grid place-items-center text-xl"
                    style={{ backgroundColor: colorFromInt(g.data.color) }}
                  >
                    🎯
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink-900 truncate">{g.data.name}</div>
                    {g.data.deadline && (
                      <div className="text-xs text-ink-500">do {g.data.deadline}</div>
                    )}
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                    <button
                      onClick={() => setEditing(g)}
                      className="text-ink-500 hover:text-ink-700 px-1"
                      title="Upravit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(g)}
                      className="text-red-500 hover:text-red-700 px-1"
                      title="Smazat"
                    >
                      🗑
                    </button>
                  </div>
                  {done && (
                    <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                      hotovo
                    </span>
                  )}
                </div>
                <div className="text-sm text-ink-600 mb-2 tabular-nums">
                  {fmt(current, g.data.currency)} / {fmt(target, g.data.currency)}
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className={`h-full ${done ? "bg-emerald-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs text-ink-500 mt-1.5">{Math.round(pct)} %</div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <GoalEditor
          initial={editing === "new" ? null : editing}
          profileSyncId={profileSyncId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function GoalEditor({
  initial,
  profileSyncId,
  onClose,
  onSaved,
}: {
  initial: GoalRow | null;
  profileSyncId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.data.name ?? "");
  const [target, setTarget] = useState(initial?.data.targetAmount ?? "");
  const [current, setCurrent] = useState(initial?.data.currentAmount ?? "0");
  const [currency, setCurrency] = useState(initial?.data.currency ?? "CZK");
  const [deadline, setDeadline] = useState(initial?.data.deadline ?? "");
  const [note, setNote] = useState(initial?.data.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!profileSyncId) return setErr("Není vybraný profil.");
    if (!name.trim()) return setErr("Vyplň název cíle.");
    const t = parseFloat(target.replace(",", "."));
    if (!t || t <= 0) return setErr("Vyplň cílovou částku.");
    const c = parseFloat(current.replace(",", ".")) || 0;

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: GoalData = {
        profileId: profileSyncId,
        name: name.trim(),
        targetAmount: t.toFixed(2),
        currentAmount: c.toFixed(2),
        currency,
        color: initial?.data.color,
        deadline: deadline || undefined,
        note,
      };
      await withAuth((tok) =>
        sync.push(tok, {
          entities: {
            goals: [
              {
                syncId: initial?.syncId ?? crypto.randomUUID(),
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? "Upravit cíl" : "Nový cíl"}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
    >
      <Field label="Název">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cílová částka">
          <input
            type="text"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Naspořeno">
          <input
            type="text"
            inputMode="decimal"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Měna">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Termín">
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Poznámka">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
    </FormDialog>
  );
}

function colorFromInt(c?: number): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
