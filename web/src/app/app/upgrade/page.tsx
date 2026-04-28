"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const [tier, setTier] = useState<Tier>("BUSINESS");
  const [period, setPeriod] = useState<Period>("MONTHLY");
  const [companyName, setCompanyName] = useState("");
  const [companyIco, setCompanyIco] = useState("");
  const [companyDic, setCompanyDic] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");

  const [payment, setPayment] = useState<StartResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPayment() {
    setCreating(true);
    setError(null);
    try {
      const res = await withAuth((t) =>
        api<StartResponse>("/api/v1/payments/start", {
          method: "POST",
          token: t,
          body: {
            tier, period,
            companyName: companyName.trim() || undefined,
            companyIco: companyIco.trim() || undefined,
            companyDic: companyDic.trim() || undefined,
            companyAddress: companyAddress.trim() || undefined,
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
        const s = await withAuth((t) =>
          api<StatusResponse>(`/api/v1/payments/${payment.paymentId}/status`, { token: t }),
        );
        if (!cancelled) setStatus(s);
        if (s.status === "PAID" || s.status === "EXPIRED" || s.status === "CANCELLED") return;
      } catch {}
      if (!cancelled) setTimeout(tick, 10_000);
    };
    tick();
    return () => { cancelled = true; };
  }, [payment]);

  // SPAYD QR rendering — server-side přes externí service
  const qrUrl = payment
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(payment.spayd)}`
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Upgrade předplatného</h1>
        <p className="text-sm text-ink-600 mt-1">
          Platba převodem nebo QR kódem. Po připsání platby se tier aktivuje automaticky
          (do 24 hodin podle tvé banky).
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Stav PAID */}
      {status?.status === "PAID" ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-3">
          <div className="text-5xl">✓</div>
          <div className="font-semibold text-emerald-900 text-lg">Platba přijata</div>
          <p className="text-emerald-800">
            Předplatné <strong>{TIER_LABELS[status.tier as Tier]}</strong> je aktivní.
            Tier se promítne při dalším přihlášení / sync.
          </p>
          <Link href="/app/dashboard" className="inline-block mt-2 text-brand-600 hover:text-brand-700">
            Přejít na přehled →
          </Link>
        </div>
      ) : payment ? (
        // Stav s vygenerovaným QR — čekáme na platbu
        <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm text-ink-500">Předplatné</div>
              <div className="text-xl font-semibold text-ink-900">
                {TIER_LABELS[payment.spayd.includes("PERSONAL") ? "PERSONAL" :
                  payment.spayd.includes("BUSINESS") ? "BUSINESS" : "ORGANIZATION"]}
                {" — "}
                {period === "MONTHLY" ? "měsíčně" : "ročně"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-ink-500">K úhradě</div>
              <div className="text-3xl font-semibold text-ink-900 tabular-nums">
                {payment.amount} {payment.currency}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6 items-center">
            {qrUrl && (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="QR platba" className="mx-auto rounded-lg border border-ink-200" />
                <p className="text-xs text-ink-500 mt-2">
                  Naskenuj QR mobilním bankovnictvím (Fio, Air Bank, ČSOB, KB…)
                </p>
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div className="font-medium text-ink-900">Nebo zadej převod ručně:</div>
              <FieldDisplay label="Číslo účtu" value={payment.bankAccount} />
              <FieldDisplay label="IBAN" value={payment.iban} />
              <FieldDisplay label="Variabilní symbol" value={payment.variableSymbol} highlight />
              <FieldDisplay label="Částka" value={`${payment.amount} ${payment.currency}`} />
              <FieldDisplay label="Zpráva pro příjemce" value={`Cointrack ${tier}`} />
            </div>
          </div>

          <div className="border-t border-ink-100 pt-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm">
              <div className="font-medium text-ink-900">Stav: {status?.status === "PENDING" ? "⏳ Čekáme na platbu" : status?.status ?? "PENDING"}</div>
              <div className="text-xs text-ink-500 mt-1">
                Platnost QR do {new Date(payment.expiresAt).toLocaleDateString("cs-CZ")}.
                Stránku můžeš nechat otevřenou — automaticky obnoví, jakmile platba dorazí.
              </div>
            </div>
            <button
              onClick={() => { setPayment(null); setStatus(null); }}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Zrušit a začít znovu
            </button>
          </div>
        </div>
      ) : (
        // Formulář pro start platby
        <div className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink-900 mb-2">Vyberte tier</label>
            <div className="grid grid-cols-3 gap-3">
              {(["PERSONAL", "BUSINESS", "ORGANIZATION"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`p-4 rounded-lg border text-center ${
                    tier === t ? "border-brand-600 bg-brand-50" : "border-ink-200 hover:bg-ink-50"
                  }`}
                >
                  <div className="font-semibold text-ink-900">{TIER_LABELS[t]}</div>
                  <div className="text-sm text-ink-600 mt-1">{PRICES[t][period]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-2">Perioda</label>
            <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setPeriod("MONTHLY")}
                className={`flex-1 py-2 ${period === "MONTHLY" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
              >
                Měsíčně
              </button>
              <button
                type="button"
                onClick={() => setPeriod("YEARLY")}
                className={`flex-1 py-2 ${period === "YEARLY" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700 hover:bg-ink-50"}`}
              >
                Ročně (2 měsíce zdarma)
              </button>
            </div>
          </div>

          <details className="border border-ink-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700">
              Fakturační údaje (volitelné, pro firmu)
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <input
                type="text"
                placeholder="Název firmy"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="IČO"
                  value={companyIco}
                  onChange={(e) => setCompanyIco(e.target.value)}
                  className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
                />
                <input
                  type="text"
                  placeholder="DIČ"
                  value={companyDic}
                  onChange={(e) => setCompanyDic(e.target.value)}
                  className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
                />
              </div>
              <input
                type="text"
                placeholder="Adresa (ulice, město, PSČ)"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 px-3 text-sm"
              />
            </div>
          </details>

          <button
            onClick={startPayment}
            disabled={creating}
            className="h-11 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {creating ? "Generuji platbu…" : `Vygenerovat QR platbu (${PRICES[tier][period]})`}
          </button>

          <p className="text-xs text-ink-500">
            Platí 7 dní. Po připsání platby na náš účet (Fio 2601115347/2010)
            se tvůj tier automaticky aktivuje. Faktura ti přijde do emailu.
          </p>
        </div>
      )}
    </div>
  );
}

function FieldDisplay({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-500">{label}:</span>
      <span
        className={`font-mono ${highlight ? "font-semibold text-brand-700" : "text-ink-900"}`}
        onClick={() => navigator.clipboard?.writeText(value)}
        title="Klikni pro zkopírování"
        style={{ cursor: "pointer" }}
      >
        {value}
      </span>
    </div>
  );
}
