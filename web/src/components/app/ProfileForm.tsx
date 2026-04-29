"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api, sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

const COLORS = [
  0xff2196f3, 0xff4caf50, 0xfff44336, 0xffff9800,
  0xff9c27b0, 0xff009688, 0xff795548, 0xff607d8b,
];

const BUSINESS_FIELD_TYPES = new Set(["PERSONAL", "BUSINESS", "ORGANIZATION"]);

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
  [key: string]: unknown;
}

export default function ProfileForm({ mode, syncId }: ProfileFormProps) {
  const t = useTranslations("profile_form");
  const router = useRouter();
  const isEdit = mode === "edit";

  // ORGANIZATION typ profilu byl sjednocen s BUSINESS — pro běžného uživatele
  // je rozdíl matoucí. Existující ORGANIZATION profily v DB zůstávají a ukazují
  // se jako "Firemní" (viz mapping níže). Pro multi-user organizační strukturu
  // s rolemi je samostatná stránka /app/organizations.
  const TYPES = [
    { value: "PERSONAL", label: t("type_personal"), desc: t("type_personal_desc") },
    { value: "BUSINESS", label: t("type_business"), desc: t("type_business_desc") },
    { value: "GROUP", label: t("type_group"), desc: t("type_group_desc") },
  ];

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
        const res = await withAuth((tk) => sync.pull(tk));
        const entity = (res.entities["profiles"] ?? []).find((e) => e.syncId === syncId);
        if (!entity) {
          setError(t("profile_not_found"));
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
  }, [isEdit, syncId, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("fill_name"));
      return;
    }
    setError(null);
    setSaving(true);

    try {
      const now = new Date().toISOString();
      const targetSyncId = isEdit ? syncId! : crypto.randomUUID();

      let organizationId = originalData?.organizationId;
      if (!isEdit && type === "ORGANIZATION") {
        try {
          const orgRes = await withAuth((tk) =>
            api<{ id: string }>("/api/v1/org", {
              method: "POST",
              token: tk,
              body: {
                name: name.trim(),
                type: "B2B",
                currency: defaultCurrency,
                inviteEmails: [],
              },
            }),
          );
          organizationId = orgRes.id;
        } catch (e) {
          setError(t("create_org_failed", { error: e instanceof Error ? e.message : String(e) }));
          setSaving(false);
          return;
        }
      }

      const data: ProfileData = {
        ...(originalData ?? {}),
        name: name.trim(),
        type,
        color,
        ico: ico || undefined,
        dic: dic || undefined,
        isVatPayer,
        companyName: companyName || undefined,
        defaultCurrency,
        organizationId,
      };

      await withAuth((tk) =>
        sync.push(tk, {
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

      if (!isEdit && type === "ORGANIZATION") {
        router.push("/app/organizations");
      } else {
        router.push("/app/profiles");
      }
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
        <Link href="/app/profiles" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900 mt-2">
          {isEdit ? t("edit_title") : t("new_title")}
        </h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
        {!isEdit && (
          <Field label={t("type_label")}>
            <div className="space-y-2">
              {TYPES.map((typ) => (
                <label
                  key={typ.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    type === typ.value
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={typ.value}
                    checked={type === typ.value}
                    onChange={(e) => setType(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-ink-900 text-sm">{typ.label}</div>
                    <div className="text-xs text-ink-600">{typ.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field label={t("name_label")}>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("name_placeholder")}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>

        <Field label={t("color_label")}>
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
                aria-label={t("select_color_aria")}
              />
            ))}
          </div>
        </Field>

        <Field label={t("currency_label")}>
          <select
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
          >
            <option value="CZK">{t("currency_czk")}</option>
            <option value="EUR">{t("currency_eur")}</option>
            <option value="USD">{t("currency_usd")}</option>
            <option value="GBP">{t("currency_gbp")}</option>
          </select>
        </Field>

        {BUSINESS_FIELD_TYPES.has(type) && (
          <div className="border-t border-ink-200 pt-5">
            <h3 className="text-sm font-medium text-ink-900 mb-3">
              {type === "PERSONAL" ? t("company_section_optional") : t("company_section")}
            </h3>
            <div className="space-y-4">
              <Field label={t("company_name_label")}>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t("company_name_placeholder")}
                  className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("ico_label")}>
                  <input
                    type="text"
                    value={ico}
                    onChange={(e) => setIco(e.target.value)}
                    placeholder="12345678"
                    className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 tabular-nums"
                  />
                </Field>
                <Field label={t("dic_label")}>
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
                <span className="text-sm text-ink-900">{t("vat_payer")}</span>
              </label>
            </div>
          </div>
        )}

        {type === "ORGANIZATION" && (
          <div className="border-t border-ink-200 pt-5">
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-sm text-brand-800 space-y-1">
              <div className="font-medium">{t("org_invites_title")}</div>
              <p className="text-xs">
                {isEdit ? t("org_invites_edit_desc") : t("org_invites_create_desc")}
              </p>
              {isEdit && (
                <Link
                  href="/app/organizations"
                  className="inline-block mt-1 text-xs underline hover:no-underline"
                >
                  {t("manage_members")}
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Link
            href="/app/profiles"
            className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
          >
            {t("cancel")}
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {saving ? t("saving") : isEdit ? t("save_edit") : t("save_create")}
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
