"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface StartResponse {
  paymentId: string;
  amount: string;
  currency: string;
  variableSymbol: string;
  iban: string;
  bankAccount: string;
  spayd: string;
  expiresAt: string;
}

interface StatusResponse {
  paymentId: string;
  status: string;
  tier: string;
  period: string;
  amount: string;
  variableSymbol: string;
  createdAt: string;
  paidAt?: string;
  expiresAt: string;
}

type Tier = "PERSONAL" | "BUSINESS" | "ORGANIZATION";
type Period = "MONTHLY" | "YEARLY";

const PRICES: Record<Tier, Record<Period, string>> = {
  PERSONAL:     { MONTHLY: "69 Kč",  YEARLY: "690 Kč"  },
  BUSINESS:     { MONTHLY: "199 Kč", YEARLY: "1 990 Kč" },
  ORGANIZATION: { MONTHLY: "399 Kč", YEARLY: "3 990 Kč" },
};

const TIER_LABELS: Record<Tier, string> = {
  PERSONAL: "Personal",
  BUSINESS: "Business",
  ORGANIZATION: "Organization",
};

export default function UpgradePage() {
  const t = useTranslations("upgrade");
  const locale = useLocale();
  const [tier, setTier] = useState<Tier>("BUSINESS");
  const [period, setPeriod] = useState<Period>("MONTHLY");
  const [billingType, setBillingType] = useState<"PERSON" | "COMPANY">("PERSON");
  const [billingName, setBillingName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [companyIco, setCompanyIco] = useState("");
  const [companyDic, setCompanyDic] = useState("");

  const [payment, setPayment] = useState<StartResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPayment() {
    setError(null);
    if (!billingName.trim()) {
      setError(billingType === "COMPANY" ? t("fill_company_name") : t("fill_person_name"));
      return;
    }
    if (!billingAddress.trim()) {
      setError(t("fill_address"));
      return;
    }
    if (billingType === "COMPANY" && !companyIco.trim()) {
      setError(t("fill_ico"));
      return;
    }

    setCreating(true);
    try {
      const res = await withAuth((tk) =>
        api<StartResponse>("/api/v1/payments/start", {
          method: "POST",
          token: tk,
          body: {
            tier, period,
            companyName: billingName.trim(),
            companyIco: billingType === "COMPANY" ? companyIco.trim() : undefined,
            companyDic: billingType === "COMPANY" ? (companyDic.trim() || undefined) : undefined,
            companyAddress: billingAddress.trim(),
          },
        }),
      );
      setPayment(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  // Poll status každých 10s
  useEffect(() => {
    if (!payment) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await withAuth((tk) =>
          api<StatusResponse>(`/api/v1/payments/${payment.paymentId}/status`, { token: tk }),
        );
        if (!cancelled) setStatus(s);
        if (s.status === "PAID" || s.status === "EXPIRED" || s.status === "CANCELLED") return;
      } catch {}
      if (!cancelled) setTimeout(tick, 10_000);
    };
    tick();
    return () => { cancelled = true; };
  }, [payment]);

  const qrUrl = payment
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(payment.spayd)}`
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {status?.status === "PAID" ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-3">
          <div className="text-5xl">✓</div>
          <div className="font-semibold text-emerald-900 text-lg">{t("paid_title")}</div>
          <p className="text-emerald-800">{t("paid_desc", { tier: TIER_LABELS[status.tier as Tier] })}</p>
          <Link href="/app/dashboard" className="inline-block mt-2 text-brand-600 hover:text-brand-700">
            {t("go_dashboard")}
          </Link>
        </div>
      ) : payment ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm text-ink-500">{t("subscription")}</div>
              <div className="text-xl font-semibold text-ink-900">
                {TIER_LABELS[payment.spayd.includes("PERSONAL") ? "PERSONAL" :
                  payment.spayd.includes("BUSINESS") ? "BUSINESS" : "ORGANIZATION"]}
                {" — "}
                {period === "MONTHLY" ? t("monthly_label") : t("yearly_label")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-ink-500">{t("to_pay")}</div>
              <div className="text-3xl font-semibold text-ink-900 tabular-nums">
                {payment.amount} {payment.currency}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6 items-center">
            {qrUrl && (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt={t("qr_alt")} className="mx-auto rounded-lg border border-ink-200" />
                <p className="text-xs text-ink-500 mt-2">{t("qr_hint")}</p>
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div className="font-medium text-ink-900">{t("manual_transfer")}</div>
              <FieldDisplay label={t("field_account")} value={payment.bankAccount} title={t("click_to_copy")} />
              <FieldDisplay label={t("field_iban")} value={payment.iban} title={t("click_to_copy")} />
              <FieldDisplay label={t("field_vs")} value={payment.variableSymbol} highlight title={t("click_to_copy")} />
              <FieldDisplay label={t("field_amount")} value={`${payment.amount} ${payment.currency}`} title={t("click_to_copy")} />
              <FieldDisplay label={t("field_message")} value={`Cointrack ${tier}`} title={t("click_to_copy")} />
            </div>
          </div>

          <div className="border-t border-ink-100 pt-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm">
              <div className="font-medium text-ink-900">
                {t("status_label")} {status?.status === "PENDING" ? t("status_pending") : status?.status ?? "PENDING"}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {t("validity_until", { date: new Date(payment.expiresAt).toLocaleDateString(locale) })}
              </div>
            </div>
            <button
              onClick={() => { setPayment(null); setStatus(null); }}
              className="text-sm text-red-600 hover:text-red-700"
            >
              {t("cancel_restart")}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink-900 mb-2">{t("select_tier")}</label>
            <div className="grid grid-cols-3 gap-3">
              {(["PERSONAL", "BUSINESS", "ORGANIZATION"] as const).map((tk) => (
                <button
                  key={tk}
                  type="button"
                  onClick={() => setTier(tk)}
                  className={`p-4 rounded-lg border text-center ${
                    tier === tk ? "border-brand-600 bg-brand-50" : "border-ink-200 hover:bg-ink-50"
                  }`}
                >
                  <div className="font-semibold text-ink-900">{TIER_LABELS[tk]}</div>
                  <div className="text-sm text-ink-600 mt-1">{PRICES[tk][period]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-2">{t("period")}</label>
            <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setPeriod("MONTHLY")}
                className={`flex-1 py-2 ${period === "MONTHLY" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
              >
                {t("period_monthly")}
              </button>
              <button
                type="button"
                onClick={() => setPeriod("YEARLY")}
                className={`flex-1 py-2 ${period === "YEARLY" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
              >
                {t("period_yearly")}
              </button>
            </div>
          </div>

          <div className="border border-ink-200 rounded-lg p-4 space-y-4">
            <div>
              <div className="text-sm font-medium text-ink-900 mb-2">{t("billing_section")}</div>
              <p className="text-xs text-ink-500 mb-3">{t("billing_required")}</p>
              <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm mb-3">
                <button
                  type="button"
                  onClick={() => setBillingType("PERSON")}
                  className={`flex-1 py-2 ${billingType === "PERSON" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
                >
                  {t("billing_person")}
                </button>
                <button
                  type="button"
                  onClick={() => setBillingType("COMPANY")}
                  className={`flex-1 py-2 ${billingType === "COMPANY" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
                >
                  {t("billing_company")}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">
                {billingType === "COMPANY" ? t("company_name_label") : t("person_name_label")}
              </label>
              <input
                type="text"
                value={billingName}
                onChange={(e) => setBillingName(e.target.value)}
                placeholder={billingType === "COMPANY" ? t("company_name_placeholder") : t("person_name_placeholder")}
                className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
              />
            </div>

            {billingType === "COMPANY" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">{t("ico_label")}</label>
                  <input
                    type="text"
                    value={companyIco}
                    onChange={(e) => setCompanyIco(e.target.value)}
                    placeholder={t("ico_placeholder")}
                    className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">{t("dic_label")}</label>
                  <input
                    type="text"
                    value={companyDic}
                    onChange={(e) => setCompanyDic(e.target.value)}
                    placeholder={t("dic_placeholder")}
                    className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm font-mono"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("address_label")}</label>
              <input
                type="text"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder={t("address_placeholder")}
                className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
              />
            </div>
          </div>

          <button
            onClick={startPayment}
            disabled={creating}
            className="h-11 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {creating ? t("generating") : t("generate_qr", { price: PRICES[tier][period] })}
          </button>

          <p className="text-xs text-ink-500">{t("validity_note")}</p>
        </div>
      )}
    </div>
  );
}

function FieldDisplay({
  label, value, highlight = false, title,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  title: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{label}:</span>
      <span
        className={`font-mono ${highlight ? "font-semibold text-brand-700" : "text-ink-900"}`}
        onClick={() => navigator.clipboard?.writeText(value)}
        title={title}
        style={{ cursor: "pointer" }}
      >
        {value}
      </span>
    </div>
  );
}
