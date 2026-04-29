"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api, sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { categoriesForFocus } from "@/lib/business-focus-categories";

const COLORS = [
  0xff2196f3, 0xff4caf50, 0xfff44336, 0xffff9800,
  0xff9c27b0, 0xff009688, 0xff795548, 0xff607d8b,
];

const BUSINESS_FIELD_TYPES = new Set(["PERSONAL", "BUSINESS", "ORGANIZATION"]);

/** BusinessFocus enum mirror z mobile (data/model/BusinessFocus.kt). */
const BUSINESS_FOCUSES = [
  "HEALTHCARE",
  "RETAIL",
  "GASTRONOMY",
  "IT_TECH",
  "CONSTRUCTION",
  "CONSULTING",
  "AGRICULTURE",
  "EDUCATION",
  "REAL_ESTATE",
  "TRANSPORT",
] as const;
type BusinessFocus = (typeof BUSINESS_FOCUSES)[number];

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
  businessFocus?: string | null;
  companyName?: string;
  companyStreet?: string;
  companyCity?: string;
  companyZip?: string;
  companyPhone?: string;
  companyEmail?: string;
  defaultCurrency?: string;
  organizationId?: string;
  cointrackUserId?: string;
  [key: string]: unknown;
}

/** ARES API response — minimální výřez, který používáme. */
interface AresResponse {
  obchodniJmeno?: string;
  dic?: string;
  sidlo?: {
    nazevObce?: string;
    psc?: number;
    uliceSCislem?: string;
    textovaAdresa?: string;
  };
}

/** iDoklad status z backendu. */
interface IDokladStatus {
  configured: boolean;
  clientId?: string;
  lastSyncAt?: string;
  tokenExpiresAt?: string;
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
  const [businessFocus, setBusinessFocus] = useState<BusinessFocus | "">("");
  const [companyName, setCompanyName] = useState("");
  const [companyStreet, setCompanyStreet] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [companyZip, setCompanyZip] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("CZK");

  // iDoklad credentials state — per-profil, ukládá se přes /api/v1/idoklad/credentials.
  // Hodnoty se v UI nezobrazují (jen status + maskovaný clientId ze serveru).
  // User je zadá → klikne Uložit → backend uloží AES-GCM šifrovaně. Sekce se zobrazí
  // jen v edit režimu (pro nový profil ještě neexistuje syncId v cloudu).
  const [idokladStatus, setIdokladStatus] = useState<IDokladStatus | null>(null);
  const [idokladClientId, setIdokladClientId] = useState("");
  const [idokladClientSecret, setIdokladClientSecret] = useState("");
  const [idokladSecretVisible, setIdokladSecretVisible] = useState(false);
  const [idokladEditing, setIdokladEditing] = useState(false);
  const [idokladSaving, setIdokladSaving] = useState(false);
  const [idokladError, setIdokladError] = useState<string | null>(null);

  // ARES lookup state
  const [aresLoading, setAresLoading] = useState(false);
  const [aresError, setAresError] = useState<string | null>(null);

  // Seed categories state (mirror z mobile: tlačítko po výběru BusinessFocus)
  const [seedingCategories, setSeedingCategories] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

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
        const bf = d.businessFocus ?? "";
        setBusinessFocus(
          BUSINESS_FOCUSES.includes(bf as BusinessFocus) ? (bf as BusinessFocus) : "",
        );
        setCompanyName(d.companyName ?? "");
        setCompanyStreet(d.companyStreet ?? "");
        setCompanyCity(d.companyCity ?? "");
        setCompanyZip(d.companyZip ?? "");
        setCompanyPhone(d.companyPhone ?? "");
        setCompanyEmail(d.companyEmail ?? "");
        setDefaultCurrency(d.defaultCurrency ?? "CZK");
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [isEdit, syncId, t]);

  // Načteme iDoklad status — jen pro edit režim, kde už syncId existuje na backendu.
  useEffect(() => {
    if (!isEdit || !syncId) return;
    (async () => {
      try {
        const s = await withAuth((tk) =>
          api<IDokladStatus>(`/api/v1/idoklad/profiles/${syncId}/status`, { token: tk }),
        );
        setIdokladStatus(s);
        // Pokud není nakonfigurován, automaticky odhalíme editační formulář
        if (!s.configured) setIdokladEditing(true);
      } catch {
        // ignore — pokud je 404 / cokoli, prostě se nezobrazí status
        setIdokladStatus({ configured: false });
        setIdokladEditing(true);
      }
    })();
  }, [isEdit, syncId]);

  /** ARES lookup — public ČR registr ekonomických subjektů. */
  async function lookupAres() {
    const cleanIco = ico.trim();
    if (cleanIco.length < 6) return;
    setAresError(null);
    setAresLoading(true);
    try {
      const res = await fetch(
        `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(cleanIco)}`,
      );
      if (!res.ok) {
        if (res.status === 404) setAresError(t("ares_not_found"));
        else setAresError(t("ares_failed", { code: String(res.status) }));
        return;
      }
      const data = (await res.json()) as AresResponse;
      if (data.obchodniJmeno) setCompanyName(data.obchodniJmeno);
      if (data.dic) setDic(data.dic);
      const sidlo = data.sidlo;
      if (sidlo) {
        const street = sidlo.uliceSCislem ?? sidlo.textovaAdresa;
        if (street) setCompanyStreet(street);
        if (sidlo.nazevObce) setCompanyCity(sidlo.nazevObce);
        if (sidlo.psc != null) setCompanyZip(String(sidlo.psc));
      }
    } catch (e) {
      setAresError(e instanceof Error ? e.message : String(e));
    } finally {
      setAresLoading(false);
    }
  }

  /**
   * Seed kategorie pro vybrané BusinessFocus.
   *
   * Stejný flow jako mobile (ProfileViewModel.seedFocusCategories):
   *   1. načti existující kategorie napříč profilem
   *   2. odfiltruj ty, jejichž název už existuje (case-sensitive match podle
   *      `name`)
   *   3. ostatní hromadně pushni jako nové kategorie přes /sync
   *
   * profileId nových kategorií = aktuálně editovaný profil (`syncId`),
   * příp. `originalData?.organizationId` pro org sdílení — pro jednoduchost
   * vždy editovaný profil. Pokud uživatel chce kategorie i v jiných
   * profilech, může je tam ručně skopírovat.
   */
  async function seedCategories() {
    if (!businessFocus || !syncId) return;
    setSeedMessage(null);
    setSeedingCategories(true);
    try {
      const focusCats = categoriesForFocus(businessFocus);
      if (focusCats.length === 0) {
        setSeedMessage(t("seed_no_categories"));
        return;
      }

      // 1) pull existing — match podle name v rámci profilu (mobile match
      //    je napříč profily, web ho zužuje na profil — kategorie jsou per
      //    profil v cloudovém modelu).
      const res = await withAuth((tk) => sync.pull(tk));
      const existingNames = new Set(
        (res.entities["categories"] ?? [])
          .filter((e) => {
            if (e.deletedAt) return false;
            const d = e.data as Record<string, unknown>;
            if (d.deletedAt != null && d.deletedAt !== 0) return false;
            return d.profileId === syncId;
          })
          .map((e) => String((e.data as Record<string, unknown>).name ?? "").trim())
          .filter((n) => n.length > 0),
      );

      // 2) filtruj ty, co ještě neexistují
      const toInsert = focusCats.filter((fc) => !existingNames.has(fc.name));
      if (toInsert.length === 0) {
        setSeedMessage(t("seed_already_exists", { focus: t(`focus_${businessFocus}` as Parameters<typeof t>[0]) }));
        return;
      }

      // 3) push v jednom requestu — server uloží všechny najednou
      const now = new Date().toISOString();
      const entities = toInsert.map((fc) => ({
        syncId: crypto.randomUUID(),
        updatedAt: now,
        clientVersion: 1,
        data: {
          profileId: syncId,
          name: fc.name,
          // Server posílá lowercase; ukládáme stejně, aby bylo konzistentní.
          type: fc.type.toLowerCase(),
          icon: fc.icon,
          color: fc.color,
        } as Record<string, unknown>,
      }));
      await withAuth((tk) => sync.push(tk, { entities: { categories: entities } }));

      setSeedMessage(t("seed_done", { count: toInsert.length }));
    } catch (e) {
      setSeedMessage(t("seed_failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSeedingCategories(false);
    }
  }

  /** Uložit iDoklad credentials přes /api/v1/idoklad/credentials. */
  async function saveIDokladCredentials() {
    if (!syncId) return;
    if (!idokladClientId.trim() || !idokladClientSecret.trim()) {
      setIdokladError(t("idoklad_fill_credentials"));
      return;
    }
    setIdokladError(null);
    setIdokladSaving(true);
    try {
      await withAuth((tk) =>
        api<{ ok: boolean }>(`/api/v1/idoklad/credentials`, {
          method: "PUT",
          token: tk,
          body: {
            profileId: syncId,
            clientId: idokladClientId.trim(),
            clientSecret: idokladClientSecret.trim(),
          },
        }),
      );
      // Reset inputs + reload status
      setIdokladClientId("");
      setIdokladClientSecret("");
      setIdokladEditing(false);
      const s = await withAuth((tk) =>
        api<IDokladStatus>(`/api/v1/idoklad/profiles/${syncId}/status`, { token: tk }),
      );
      setIdokladStatus(s);
    } catch (e) {
      setIdokladError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdokladSaving(false);
    }
  }

  /** Smazat iDoklad credentials z backendu. */
  async function clearIDokladCredentials() {
    if (!syncId) return;
    if (!confirm(t("idoklad_disconnect_confirm"))) return;
    try {
      await withAuth((tk) =>
        api(`/api/v1/idoklad/profiles/${syncId}/credentials`, {
          method: "DELETE",
          token: tk,
        }),
      );
      setIdokladStatus({ configured: false });
      setIdokladEditing(true);
    } catch (e) {
      setIdokladError(e instanceof Error ? e.message : String(e));
    }
  }

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
        businessFocus: type === "BUSINESS" && businessFocus ? businessFocus : null,
        companyName: companyName || undefined,
        companyStreet: companyStreet || undefined,
        companyCity: companyCity || undefined,
        companyZip: companyZip || undefined,
        companyPhone: companyPhone || undefined,
        companyEmail: companyEmail || undefined,
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

  const showBusinessSection = BUSINESS_FIELD_TYPES.has(type);
  const showFocusSection = type === "BUSINESS";
  const showIDokladSection = isEdit && BUSINESS_FIELD_TYPES.has(type);

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

        {showBusinessSection && (
          <div className="border-t border-ink-200 pt-5 space-y-4">
            <h3 className="text-sm font-medium text-ink-900">
              {type === "PERSONAL" ? t("company_section_optional") : t("company_section")}
            </h3>

            {showFocusSection && (
              <Field label={t("focus_label")}>
                <select
                  value={businessFocus}
                  onChange={(e) => {
                    setBusinessFocus(e.target.value as BusinessFocus | "");
                    setSeedMessage(null);
                  }}
                  className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
                >
                  <option value="">{t("focus_none")}</option>
                  {BUSINESS_FOCUSES.map((f) => (
                    <option key={f} value={f}>
                      {t(`focus_${f}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
                {businessFocus && (
                  <div className="mt-2 space-y-2">
                    {seedMessage && (
                      <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        {seedMessage}
                      </div>
                    )}
                    {isEdit ? (
                      <button
                        type="button"
                        onClick={seedCategories}
                        disabled={seedingCategories}
                        className="h-9 px-3 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-medium disabled:opacity-50 border border-brand-200"
                      >
                        {seedingCategories ? t("seed_loading") : t("seed_btn")}
                      </button>
                    ) : (
                      <p className="text-xs text-ink-500">{t("seed_save_first")}</p>
                    )}
                  </div>
                )}
              </Field>
            )}

            <Field label={t("company_name_label")}>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={t("company_name_placeholder")}
                className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
              />
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <Field label={t("ico_label")}>
                <input
                  type="text"
                  value={ico}
                  onChange={(e) => setIco(e.target.value)}
                  placeholder="12345678"
                  className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 tabular-nums"
                />
              </Field>
              <button
                type="button"
                onClick={lookupAres}
                disabled={ico.trim().length < 6 || aresLoading}
                className="h-11 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
              >
                {aresLoading ? t("ares_loading") : t("ares_lookup_btn")}
              </button>
            </div>
            {aresError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {aresError}
              </div>
            )}

            <Field label={t("dic_label")}>
              <input
                type="text"
                value={dic}
                onChange={(e) => setDic(e.target.value)}
                placeholder="CZ12345678"
                className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
              />
            </Field>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isVatPayer}
                onChange={(e) => setIsVatPayer(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm text-ink-900 block">{t("vat_payer")}</span>
                <span className="text-xs text-ink-500">{t("vat_payer_desc")}</span>
              </div>
            </label>

            <Field label={t("company_street_label")}>
              <input
                type="text"
                value={companyStreet}
                onChange={(e) => setCompanyStreet(e.target.value)}
                className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
              />
            </Field>

            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <Field label={t("company_zip_label")}>
                <input
                  type="text"
                  value={companyZip}
                  onChange={(e) => setCompanyZip(e.target.value)}
                  inputMode="numeric"
                  className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 tabular-nums"
                />
              </Field>
              <Field label={t("company_city_label")}>
                <input
                  type="text"
                  value={companyCity}
                  onChange={(e) => setCompanyCity(e.target.value)}
                  className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
                />
              </Field>
            </div>

            <Field label={t("company_phone_label")}>
              <input
                type="tel"
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
                className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
              />
            </Field>

            <Field label={t("company_email_label")}>
              <input
                type="email"
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
                className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900"
              />
            </Field>
          </div>
        )}

        {showIDokladSection && (
          <div className="border-t border-ink-200 pt-5 space-y-3">
            <div>
              <h3 className="text-sm font-medium text-ink-900">{t("idoklad_section_title")}</h3>
              <p className="text-xs text-ink-600 mt-1">{t("idoklad_section_desc")}</p>
            </div>

            {idokladError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                {idokladError}
              </div>
            )}

            {idokladStatus?.configured && !idokladEditing ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-emerald-900">
                    <div className="font-medium">{t("idoklad_connected")}</div>
                    {idokladStatus.clientId && (
                      <div className="text-xs text-emerald-800 font-mono">
                        {t("idoklad_client_id_label")} {idokladStatus.clientId}
                      </div>
                    )}
                    {idokladStatus.lastSyncAt && (
                      <div className="text-xs text-emerald-800">
                        {t("idoklad_last_sync", {
                          date: new Date(idokladStatus.lastSyncAt).toLocaleString(),
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIdokladEditing(true)}
                      className="h-8 px-3 rounded text-xs border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                    >
                      {t("idoklad_change")}
                    </button>
                    <button
                      type="button"
                      onClick={clearIDokladCredentials}
                      className="h-8 px-3 rounded text-xs text-red-700 hover:bg-red-50"
                    >
                      {t("idoklad_disconnect")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label={t("idoklad_client_id_field")}>
                  <input
                    type="text"
                    value={idokladClientId}
                    onChange={(e) => setIdokladClientId(e.target.value)}
                    placeholder="abc123…"
                    className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 text-ink-900 font-mono text-sm"
                  />
                </Field>
                <Field label={t("idoklad_client_secret_field")}>
                  <div className="relative">
                    <input
                      type={idokladSecretVisible ? "text" : "password"}
                      value={idokladClientSecret}
                      onChange={(e) => setIdokladClientSecret(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-11 rounded-lg border border-ink-300 bg-white px-3 pr-12 text-ink-900 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setIdokladSecretVisible((v) => !v)}
                      className="absolute inset-y-0 right-2 px-2 text-xs text-ink-500 hover:text-ink-700"
                      tabIndex={-1}
                    >
                      {idokladSecretVisible ? t("idoklad_hide") : t("idoklad_show")}
                    </button>
                  </div>
                </Field>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveIDokladCredentials}
                    disabled={idokladSaving}
                    className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {idokladSaving ? t("idoklad_saving") : t("idoklad_save")}
                  </button>
                  {idokladStatus?.configured && (
                    <button
                      type="button"
                      onClick={() => {
                        setIdokladEditing(false);
                        setIdokladClientId("");
                        setIdokladClientSecret("");
                        setIdokladError(null);
                      }}
                      className="h-9 px-4 rounded-lg border border-ink-300 text-ink-700 text-sm hover:bg-ink-50"
                    >
                      {t("idoklad_cancel")}
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-500">
                  {t("idoklad_help_pre")}{" "}
                  <a
                    href="https://app.idoklad.cz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline"
                  >
                    {t("idoklad_help_link")}
                  </a>{" "}
                  {t("idoklad_help_post")}
                </p>
              </div>
            )}
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
