"use client";

import { useEffect, useState } from "react";
import { bank, BankConnectionDto, ApiError } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

export default function BanksPage() {
  const [connections, setConnections] = useState<BankConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await withAuth((t) => bank.listConnections(t));
      setConnections(res.connections);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await withAuth((t) => bank.connect(t, undefined, "cs"));
      // Otevři connect_url v novém okně — uživatel se vrátí na /bank/return
      window.open(res.connectUrl, "_blank", "width=500,height=700,noopener,noreferrer");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function onReconnect(id: string) {
    try {
      const res = await withAuth((t) => bank.reconnect(t, id, "cs"));
      window.open(res.connectUrl, "_blank", "width=500,height=700,noopener,noreferrer");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Opravdu odpojit banku? Transakce zůstanou.")) return;
    try {
      await withAuth((t) => bank.delete(t, id));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Banky</h1>
          <p className="text-sm text-ink-600 mt-1">
            Napojení na bankovní účty přes PSD2 (Salt Edge). Transakce se automaticky stáhnou.
          </p>
        </div>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-60"
        >
          {connecting ? "Otevírám…" : "+ Přidat banku"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : connections.length === 0 ? (
        <EmptyBanks />
      ) : (
        <div className="space-y-4">
          {connections.map((c) => (
            <BankCard
              key={c.id}
              conn={c}
              onReconnect={() => onReconnect(c.id)}
              onDelete={() => onDelete(c.id)}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-ink-500 bg-ink-50 border border-ink-200 rounded-lg p-3">
        💡 Po kliknutí na <strong>Přidat banku</strong> se ti otevře nové okno s výběrem banky
        a přihlášením přes Salt Edge. Po potvrzení se transakce stáhnou automaticky (trvá pár
        sekund) a zobrazí se v seznamu <a href="/app/transactions" className="text-brand-600 hover:underline">Transakce</a>.
      </div>
    </div>
  );
}

function EmptyBanks() {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
      <div className="text-4xl mb-3">🏦</div>
      <div className="font-medium text-ink-900">Žádná banka není napojená</div>
      <p className="text-sm text-ink-600 mt-2">
        Klikni na „Přidat banku“. Potřebuješ PSD2 přihlášení do své online banky.
      </p>
    </div>
  );
}

function BankCard({
  conn,
  onReconnect,
  onDelete,
}: {
  conn: BankConnectionDto;
  onReconnect: () => void;
  onDelete: () => void;
}) {
  const isActive = conn.status.toLowerCase() === "active";
  const expiresInDays = conn.consentExpiresAt
    ? Math.floor((new Date(conn.consentExpiresAt).getTime() - Date.now()) / 86400_000)
    : null;
  const warnExpiry = expiresInDays !== null && expiresInDays <= 7 && expiresInDays >= 0;

  return (
    <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-lg bg-brand-100 grid place-items-center text-brand-700 text-xl">
          🏦
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink-900 truncate">
            {conn.providerName || conn.providerCode || "Banka"}
          </div>
          <div className="text-xs text-ink-600 mt-0.5">
            <span
              className={
                isActive
                  ? "text-emerald-700"
                  : conn.status === "error"
                    ? "text-red-700"
                    : "text-ink-500"
              }
            >
              {labelStatus(conn.status)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {!isActive && (
            <button
              onClick={onReconnect}
              className="h-9 px-3 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 text-sm hover:bg-brand-100"
            >
              Obnovit
            </button>
          )}
          <button
            onClick={onDelete}
            className="h-9 px-3 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50"
          >
            Odpojit
          </button>
        </div>
      </div>

      {(warnExpiry || !isActive) && (
        <div
          className={`px-5 py-3 text-xs border-t ${
            !isActive
              ? "bg-red-50 border-red-100 text-red-800"
              : "bg-amber-50 border-amber-100 text-amber-800"
          }`}
        >
          {!isActive
            ? conn.lastError || "Připojení není aktivní. Klikni Obnovit."
            : `Souhlas vyprší za ${expiresInDays} ${expiresInDays === 1 ? "den" : "dní"}. Obnov ho, jinak se sync zastaví.`}
        </div>
      )}

      {conn.accounts.length > 0 && (
        <div className="border-t border-ink-100 divide-y divide-ink-100">
          {conn.accounts.map((a) => (
            <div key={a.id} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-900 truncate">
                  {a.name || a.iban || a.accountNumber || "Účet"}
                </div>
                {a.iban && <div className="text-xs text-ink-500">{a.iban}</div>}
              </div>
              <div className="text-sm font-medium tabular-nums text-ink-900">
                {a.balance ?? "—"} {a.currencyCode}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelStatus(s: string): string {
  switch (s.toLowerCase()) {
    case "active":
      return "Aktivní";
    case "inactive":
      return "Neaktivní";
    case "disabled":
      return "Odpojeno";
    case "error":
      return "Chyba";
    default:
      return s;
  }
}
