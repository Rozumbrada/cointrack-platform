"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

const COLORS = [
  0xff2196f3, 0xff4caf50, 0xfff44336, 0xffff9800,
  0xff9c27b0, 0xff009688, 0xff795548, 0xff607d8b,
];

const TYPES = [
  { value: "PERSONAL", label: "Osobní", desc: "Pro tvé osobní finance" },
  { value: "BUSINESS", label: "Firemní", desc: "OSVČ / s.r.o. — IČO, DPH" },
  { value: "GROUP", label: "Skupinový", desc: "Sdílené výdaje mezi členy skupiny" },
];

interface ProfileFormProps {
  mode: "create" | "edit";
  syncId?: string;
}

interface ProfileData {
  name: string;
  type?: string;
  color?: number;
  ico?: string;
  dic?: string;
  isVatPayer?: boolean;
  companyName?: string;
  defaultCurrency?: string;
  organizationId?: string;
  cointrackUserId?: string;
  [key: string]: unknown;  // pro zachování ostatních fields při editu
}

export default function ProfileForm({ mode, syncId }: ProfileFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [name, setName] = useState("");
  const [type, setType] = useState("PERSONAL");
  const [color, setColor] = useState(COLORS[0]);
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [isVatPayer, setIsVatPayer] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("CZK");

  const [originalData, setOriginalData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !syncId) return;
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        const entity = (res.entities["profiles"] ?? []).find((e) => e.syncId === syncId);
        if (!entity) {
          setError("Profil nenalezen.");
          setLoading(false);
          return;
        }
        const d = entity.data as unknown as ProfileData;
        setOriginalData(d);
        setName(d.name ?? "");
        setType(d.type ?? "PERSONAL");
        setColor(d.color ?? COLORS[0]);
        setIco(d.ico ?? "");
        setDic(d.dic ?? "");
        setIsVatPayer(!!d.isVatPayer);
        setCompanyName(d.companyName ?? "");
        setDefaultCurrency(d.defaultCurrency ?? "CZK");
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [isEdit, syncId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Vyplň název profilu.");
      return;
    }
    setError(null);
    setSaving(true);

    try {
      const now = new Date().toISOString();
      const targetSyncId = isEdit ? syncId! : crypto.randomUUID();
      const data: ProfileData = {
        ...(originalData ?? {}),  // zachování dalších polí (např. cointrackUserId)
        name: name.trim(),
        type,
        color,
        ico: ico || undefined,
        dic: dic || undefined,
        isVatPayer,
        companyName: companyName || undefined,
        defaultCurrency,
      };

      await withAuth((t) =>
        sync.push(t, {
          entities: {
            profiles: [
              {
                syncId: targetSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );

      router.push("/app/profiles");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/app/profiles" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět na profily
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900 mt-2">
          {isEdit ? "Upravit profil" : "Nový profil"}
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
        {/* Type — disabled v edit, protože změna typu by měla nepříjemné side effecty */}
        {!isEdit && (
          <Field label="Typ profilu">
            <div className="space-y-2">
              {TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    type === t.value
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t.value}
                    checked={type === t.value}
                    onChange={(e) => setType(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-ink-900 text-sm">{t.label}</div>
                    <div className="text-xs text-ink-600">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field label="Název profilu *">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="např. Osobní, Firma s.r.o., Domácnost"
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label="Barva">
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-9 h-9 rounded-full border-2 transition-all ${
                  color === c ? "border-ink-900 scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: argbToCss(c) }}
                aria-label="Vybrat barvu"
              />
            ))}
          </div>
        </Field>

        <Field label="Měna">
          <select
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            <option value="CZK">CZK — Česká koruna</option>
            <option value="EUR">EUR — Euro</option>
            <option value="USD">USD — US Dollar</option>
            <option value="GBP">GBP — British Pound</option>
          </select>
        </Field>

        {/* Business pole jen pro BUSINESS typ */}
        {type === "BUSINESS" && (
          <>
            <div className="border-t border-ink-200 pt-5">
              <h3 className="text-sm font-medium text-ink-900 mb-3">Firemní údaje</h3>
              <div className="space-y-4">
                <Field label="Název firmy">
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="např. Cointrack s.r.o."
                    className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="IČO">
                    <input
                      type="text"
                      value={ico}
                      onChange={(e) => setIco(e.target.value)}
                      placeholder="12345678"
                      className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 tabular-nums"
                    />
                  </Field>
                  <Field label="DIČ">
                    <input
                      type="text"
                      value={dic}
                      onChange={(e) => setDic(e.target.value)}
                      placeholder="CZ12345678"
                      className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVatPayer}
                    onChange={(e) => setIsVatPayer(e.target.checked)}
                  />
                  <span className="text-sm text-ink-900">Plátce DPH</span>
                </label>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/app/profiles"
            className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
          >
            Zrušit
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {saving ? "Ukládám…" : isEdit ? "Uložit změny" : "Vytvořit profil"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-900 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function argbToCss(c: number): string {
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
