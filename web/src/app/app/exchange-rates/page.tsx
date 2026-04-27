"use client";

import { useEffect, useState } from "react";

interface RatesResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

const POPULAR = ["EUR", "USD", "GBP", "CHF", "PLN", "HUF", "JPY", "AUD", "CAD", "DKK", "NOK", "SEK"];

export default function ExchangeRatesPage() {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<"CZK" | "EUR" | "USD">("CZK");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RatesResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [base]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Kurzy měn</h1>
          <p className="text-sm text-ink-600 mt-1">
            Aktuální měnové kurzy z ExchangeRate-API.
            {data?.date && <span className="ml-2">Datum: {data.date}</span>}
          </p>
        </div>
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["CZK", "EUR", "USD"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBase(b)}
              className={`px-4 py-2 ${
                base === b ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              1 {b}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Nepodařilo se načíst kurzy: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : data ? (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Měna</th>
                <th className="px-6 py-3 font-medium text-right">1 {base} =</th>
                <th className="px-6 py-3 font-medium text-right">1 cizí měna =</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {POPULAR.filter((c) => data.rates[c]).map((c) => (
                <tr key={c}>
                  <td className="px-6 py-3 font-medium text-ink-900">{c}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-ink-700">
                    {data.rates[c].toLocaleString("cs-CZ", { maximumFractionDigits: 4 })} {c}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-ink-700">
                    {(1 / data.rates[c]).toLocaleString("cs-CZ", { maximumFractionDigits: 4 })} {base}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
