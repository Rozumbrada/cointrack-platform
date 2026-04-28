"use client";

import { ReactNode } from "react";
import { useTranslations } from "next-intl";

export function FormDialog({
  title,
  onClose,
  onSave,
  saving,
  error,
  saveLabel,
  saveDisabled,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  error?: string | null;
  saveLabel?: string;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  const tc = useTranslations("common");
  const effectiveSaveLabel = saveLabel ?? tc("save");
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">{children}</div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-ink-300 text-sm text-ink-700 hover:bg-ink-50"
          >
            {tc("cancel")}
          </button>
          <button
            onClick={onSave}
            disabled={!!saving || saveDisabled}
            className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? tc("saving") : effectiveSaveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";
