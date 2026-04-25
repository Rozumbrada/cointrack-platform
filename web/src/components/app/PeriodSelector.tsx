"use client";

import { useState } from "react";

export type Period = "7d" | "30d" | "3m" | "6m" | "1y" | "all" | "custom";

export interface PeriodRange {
  /** ISO date YYYY-MM-DD or null pro neomezený start */
  from: string | null;
  /** ISO date YYYY-MM-DD nebo null pro neomezený konec */
  to: string | null;
}

/** Spočítá konkrétní `from`/`to` pro pojmenované období. Custom vrací uživatelské hodnoty. */
export function periodRange(
  period: Period,
  custom?: { from: string; to: string },
): PeriodRange {
  if (period === "all") return { from: null, to: null };
  if (period === "custom") {
    return {
      from: custom?.from || null,
      to: custom?.to || null,
    };
  }
  const d = new Date();
  switch (period) {
    case "7d": d.setDate(d.getDate() - 7); break;
    case "30d": d.setDate(d.getDate() - 30); break;
    case "3m": d.setMonth(d.getMonth() - 3); break;
    case "6m": d.setMonth(d.getMonth() - 6); break;
    case "1y": d.setFullYear(d.getFullYear() - 1); break;
  }
  return { from: d.toISOString().slice(0, 10), to: null };
}

export function PeriodSelector({
  period,
  onChange,
  custom,
  onCustomChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
  custom?: { from: string; to: string };
  onCustomChange?: (c: { from: string; to: string }) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const options: Array<{ value: Period; label: string }> = [
    { value: "7d", label: "7 dní" },
    { value: "30d", label: "30 dní" },
    { value: "3m", label: "3 měs." },
    { value: "6m", label: "6 měs." },
    { value: "1y", label: "1 rok" },
    { value: "all", label: "Vše" },
  ];

  const customLabel =
    custom?.from && custom?.to
      ? `${formatShort(custom.from)} – ${formatShort(custom.to)}`
      : "Vlastní";

  return (
    <div className="flex flex-wrap items-center gap-2 self-start">
      <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-xs">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-2 ${
              period === o.value
                ? "bg-brand-50 text-brand-700"
                : "text-ink-700 hover:bg-ink-50"
            }`}
          >
            {o.label}
          </button>
        ))}
        {onCustomChange && (
          <button
            onClick={() => {
              onChange("custom");
              setPickerOpen(true);
            }}
            className={`px-3 py-2 ${
              period === "custom"
                ? "bg-brand-50 text-brand-700"
                : "text-ink-700 hover:bg-ink-50"
            }`}
          >
            {period === "custom" ? customLabel : "Vlastní"}
          </button>
        )}
      </div>

      {pickerOpen && onCustomChange && (
        <CustomRangeDialog
          initial={custom ?? { from: "", to: "" }}
          onClose={() => setPickerOpen(false)}
          onSave={(c) => {
            onCustomChange(c);
            onChange("custom");
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CustomRangeDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: { from: string; to: string };
  onClose: () => void;
  onSave: (c: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-900">Vlastní období</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-ink-600 mb-1">Od</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-600 mb-1">Do</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900"
            />
          </label>
        </div>
        {from && to && from > to && (
          <div className="text-xs text-red-700">Začátek nesmí být po konci.</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-ink-300 text-sm text-ink-700 hover:bg-ink-50"
          >
            Zrušit
          </button>
          <button
            onClick={() => {
              if (!from || !to || from > to) return;
              onSave({ from, to });
            }}
            disabled={!from || !to || from > to}
            className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            Použít
          </button>
        </div>
      </div>
    </div>
  );
}

function formatShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
