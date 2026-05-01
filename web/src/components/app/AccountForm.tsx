"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { ServerAccount } from "@/lib/sync-types";
import { getCurrentProfileSyncId } from "@/lib/profile-store";

const COLORS = [
  0xff2196f3, 0xff4caf50, 0xfff44336, 0xffff9800,
  0xff9c27b0, 0xff009688, 0xff795548, 0xff607d8b,
];

const TYPES = [
  { value: "CASH", emoji: "💵" },
  { value: "BANK", emoji: "🏦" },
  { value: "CREDIT_CARD", emoji: "💳" },
  { value: "INVESTMENT", emoji: "📈" },
  { value: "OTHER", emoji: "💰" },
];

const CURRENCIES = ["CZK", "EUR", "USD", "GBP"];

interface AccountFormProps {
  mode: "create" | "edit";
  syncId?: string;
}

export default function AccountForm({ mode, syncId }: AccountFormProps) {
  const t = useTranslations("account_form");
  const router = useRouter();
  const isEdit = mode === "edit";

  const [name, setName] = useState("");
  const [type, setType] = useState("BANK");
  const [currency, setCurrency] = useState("CZK");
  const [initialBalance, setInitialBalance] = useState("0");
  const [color, setColor] = useState(COLORS[0]);
  const [excludedFromTotal, setExcludedFromTotal] = useState(false);
  const [bankIban, setBankIban] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [pohodaShortcut, setPohodaShortcut] = useState("");

  const [originalData, setOriginalData] = useState<ServerAccount | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !syncId) return;
    (async () => {
      try {
        const res = await withAuth((tk) => sync.pull(tk));
        const entity = (res.entities["accounts"] ?? []).find((e) => e.syncId === syncId);
        if (!entity) {
          setError(t("not_found"));
          setLoading(false);
          return;
        }
        const d = entity.data as unknown as ServerAccount;
        setOriginalData(d);
        setName(d.name ?? "");
        setType(d.type ?? "BANK");
        setCurrency(d.currency ?? "CZK");
        setInitialBalance(d.initialBalance ?? "0");
        setColor(d.color ?? COLORS[0]);
        setExcludedFromTotal(!!d.excludedFromTotal);
        setBankIban(d.bankIban ?? "");
        setBankAccountNumber(d.bankAccountNumber ?? "");
        setBankCode(d.bankCode ?? "");
        setPohodaShortcut(d.pohodaShortcut ?? "");
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [isEdit, syncId, t]);

  async function onSave() {
    if (!name.trim()) {
      setError(t("name_required"));
      return;
    }
    setError(null);
    setSaving(true);

    try {
      const profileSyncId = getCurrentProfileSyncId();
      if (!profileSyncId) {
        setError(t("no_profile"));
        setSaving(false);
        return;
      }
      const targetSyncId = isEdit ? syncId! : crypto.randomUUID();
      const now = new Date().toISOString();

      const data: Record<string, unknown> = {
        ...(originalData ?? {}),
        profileId: originalData?.profileId ?? profileSyncId,
        name: name.trim(),
        type,
        currency,
        initialBalance: initialBalance.trim() || "0",
        color,
        excludedFromTotal,
        bankIban: bankIban.trim() || undefined,
        bankAccountNumber: bankAccountNumber.trim() || undefined,
        bankCode: bankCode.trim() || undefined,
        pohodaShortcut: pohodaShortcut.trim() || undefined,
      };

      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            accounts: [
              {
                syncId: targetSyncId,
                updatedAt: now,
                clientVersion: 1,
                data,
              },
            ],
          },
        }),
      );

      router.push("/app/accounts");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">
          {isEdit ? t("title_edit") : t("title_new")}
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
        {/* Name */}
        <Field label={t("name")}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("name_placeholder")}
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            autoFocus
          />
        </Field>

        {/* Type */}
        <Field label={t("type")}>
          <div className="grid grid-cols-5 gap-2">
            {TYPES.map((tp) => (
              <button
                key={tp.value}
                type="button"
                onClick={() => setType(tp.value)}
                className={`h-12 rounded-lg border text-2xl transition-all ${
                  type === tp.value
                    ? "border-brand-500 bg-brand-50"
                    : "border-ink-300 hover:border-ink-400"
                }`}
                title={t(`type_${tp.value.toLowerCase()}` as never) as string}
              >
                {tp.emoji}
              </button>
            ))}
          </div>
        </Field>

        {/* Currency + initial balance */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("currency")}>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("initial_balance")}>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              step="0.01"
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm tabular-nums"
            />
          </Field>
        </div>

        {/* Color */}
        <Field label={t("color")}>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-9 h-9 rounded-lg border-2 transition-all ${
                  color === c ? "border-ink-900 scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: hexFromInt(c) }}
                title={`#${c.toString(16)}`}
              />
            ))}
          </div>
        </Field>

        {/* Include in total */}
        <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-ink-50">
          <input
            type="checkbox"
            checked={!excludedFromTotal}
            onChange={(e) => setExcludedFromTotal(!e.target.checked)}
            className="mt-0.5 w-4 h-4"
          />
          <div>
            <div className="text-sm font-medium text-ink-900">{t("include_in_total")}</div>
            <div className="text-xs text-ink-600 mt-0.5">{t("include_in_total_desc")}</div>
          </div>
        </label>

        {/* Bank + Pohoda fields — pro všechny non-CASH účty (CASH = pokladna,
            tam Pohoda Zkratku nepotřebuje). Pohoda Zkratka je KLÍČ pro
            export — bez ní karetní účtenky importují do Pokladny. */}
        {type !== "CASH" && (
          <>
            <div className="border-t border-ink-200 pt-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-3">{t("bank_section")}</h3>
              <p className="text-xs text-ink-600 mb-3">{t("bank_section_hint")}</p>
              <div className="space-y-4">
                <Field label={t("iban")}>
                  <input
                    type="text"
                    value={bankIban}
                    onChange={(e) => setBankIban(e.target.value)}
                    placeholder="CZ65 0800 0000 1920 0014 5399"
                    className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("account_number")} className="col-span-2">
                    <input
                      type="text"
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      placeholder="0000192000145399"
                      className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                    />
                  </Field>
                  <Field label={t("bank_code")}>
                    <input
                      type="text"
                      value={bankCode}
                      onChange={(e) => setBankCode(e.target.value)}
                      placeholder="0800"
                      maxLength={4}
                      className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                    />
                  </Field>
                </div>
                <Field label={t("pohoda_shortcut")}>
                  <input
                    type="text"
                    value={pohodaShortcut}
                    onChange={(e) => setPohodaShortcut(e.target.value)}
                    placeholder="FIO"
                    maxLength={19}
                    className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm font-mono"
                  />
                  <div className="text-xs text-ink-500 mt-1">{t("pohoda_shortcut_hint")}</div>
                </Field>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-3">
        <Link
          href="/app/accounts"
          className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
        >
          {t("cancel")}
        </Link>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !name.trim()}
          className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {saving ? t("saving") : isEdit ? t("save") : t("create")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <div className="text-xs font-medium text-ink-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

function hexFromInt(c: number): string {
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
