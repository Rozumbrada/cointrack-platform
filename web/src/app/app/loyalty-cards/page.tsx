"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";

interface LoyaltyCardData {
  profileId: string;
  storeName: string;
  cardNumber: string;
  /** "QR_CODE" | "CODE_128" | "EAN_13" | "EAN_8" | "CODE_39" */
  barcodeFormat?: string;
  /** Android ARGB int (0xAARRGGBB). */
  color?: number;
  note?: string;
  logoUrl?: string;
  frontImageKey?: string;
  backImageKey?: string;
}

export default function LoyaltyCardsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const cards = entitiesByProfile<LoyaltyCardData>("loyalty_cards");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<{ syncId: string; data: LoyaltyCardData } | null>(null);

  const filtered = useMemo(() => {
    return [...cards]
      .filter((c) =>
        query
          ? c.data.storeName.toLowerCase().includes(query.toLowerCase()) ||
            c.data.cardNumber.toLowerCase().includes(query.toLowerCase())
          : true,
      )
      .sort((a, b) => a.data.storeName.localeCompare(b.data.storeName));
  }, [cards, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Věrnostní karty</h1>
        <p className="text-sm text-ink-600 mt-1">
          Tvoje karty z mobilní aplikace. Klikni pro zobrazení čárového kódu.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      <input
        type="text"
        placeholder="Hledat obchod nebo číslo karty…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">💳</div>
          <div className="font-medium text-ink-900">Žádné věrnostní karty</div>
          <p className="text-sm text-ink-600 mt-2">
            Naskenuj kartu v mobilní aplikaci v sekci Věrnostní karty.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <CardTile key={c.syncId} card={c} onClick={() => setActive(c)} />
          ))}
        </div>
      )}

      {active && <CardModal card={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function CardTile({
  card,
  onClick,
}: {
  card: { syncId: string; data: LoyaltyCardData };
  onClick: () => void;
}) {
  const d = card.data;
  const bg = colorFromArgb(d.color) || "linear-gradient(135deg, #6366f1, #8b5cf6)";
  const initials = d.storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-2xl border border-ink-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      <div
        className="aspect-[1.6/1] p-4 text-white flex items-end relative"
        style={{ background: bg }}
      >
        <div className="absolute top-3 right-3 bg-white/20 backdrop-blur px-2 py-1 rounded text-[10px] uppercase tracking-wide">
          {labelFormat(d.barcodeFormat)}
        </div>
        {d.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.logoUrl}
            alt={d.storeName}
            className="absolute top-3 left-3 w-9 h-9 rounded-md bg-white object-contain p-1"
          />
        ) : (
          <div className="absolute top-3 left-3 w-9 h-9 rounded-md bg-white/30 grid place-items-center text-white font-bold">
            {initials || "?"}
          </div>
        )}
        <div>
          <div className="text-lg font-semibold drop-shadow-sm">{d.storeName}</div>
          <div className="text-sm font-mono tracking-wider opacity-90">
            {formatCardNumber(d.cardNumber)}
          </div>
        </div>
      </div>
      {d.note && (
        <div className="px-4 py-2 text-xs text-ink-600 truncate border-t border-ink-100">
          {d.note}
        </div>
      )}
    </button>
  );
}

function CardModal({
  card,
  onClose,
}: {
  card: { syncId: string; data: LoyaltyCardData };
  onClose: () => void;
}) {
  const d = card.data;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100">
          <h2 className="text-lg font-semibold text-ink-900">{d.storeName}</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          <Barcode
            value={d.cardNumber}
            format={d.barcodeFormat || "CODE_128"}
          />

          <div className="text-center">
            <div className="text-xs text-ink-500 uppercase tracking-wide mb-1">Číslo karty</div>
            <div className="text-lg font-mono tracking-wider text-ink-900">
              {formatCardNumber(d.cardNumber)}
            </div>
          </div>

          {d.note && (
            <div className="bg-ink-50 rounded-lg p-3 text-sm text-ink-700 whitespace-pre-wrap">
              {d.note}
            </div>
          )}

          {(d.frontImageKey || d.backImageKey) && (
            <CardPhotos
              frontKey={d.frontImageKey}
              backKey={d.backImageKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Barcode({ value, format }: { value: string; format: string }) {
  // Renderuje čárák/QR přes barcode.tec-it.com — server-side rendered SVG, žádné cookie.
  // Mapování formátů na tec-it parametr `code`.
  const codeMap: Record<string, string> = {
    QR_CODE: "QRCode",
    CODE_128: "Code128",
    CODE_39: "Code39",
    EAN_13: "EAN13",
    EAN_8: "EAN8",
  };
  const code = codeMap[format] ?? "Code128";
  const url = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(value)}&code=${code}&dpi=150&imagetype=Svg&rotation=0`;

  return (
    <div className="bg-white rounded-lg p-4 border border-ink-200 grid place-items-center min-h-[140px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Čárový kód: ${value}`} className="max-w-full h-auto" />
    </div>
  );
}

function CardPhotos({
  frontKey,
  backKey,
}: {
  frontKey?: string;
  backKey?: string;
}) {
  const [urls, setUrls] = useState<{ front?: string; back?: string }>({});
  const [errs, setErrs] = useState<{ front?: string; back?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: { front?: string; back?: string } = {};
      const errNext: { front?: string; back?: string } = {};
      for (const [side, key] of [["front", frontKey], ["back", backKey]] as const) {
        if (!key) continue;
        try {
          const res = await withAuth((t) =>
            api<{ downloadUrl: string; expiresIn: number }>(
              `/api/v1/files/download-url?key=${encodeURIComponent(key)}`,
              { token: t },
            ),
          );
          if (res.downloadUrl) next[side] = res.downloadUrl;
        } catch (e) {
          errNext[side] = e instanceof Error ? e.message : String(e);
        }
      }
      if (!cancelled) {
        setUrls(next);
        setErrs(errNext);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frontKey, backKey]);

  const sides: Array<{ side: "front" | "back"; label: string; key?: string }> = [
    { side: "front", label: "Přední strana", key: frontKey },
    { side: "back", label: "Zadní strana", key: backKey },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {sides
        .filter((s) => s.key)
        .map((s) => (
          <div key={s.side}>
            <div className="text-xs text-ink-500 mb-1">{s.label}</div>
            <div className="aspect-[1.6/1] bg-ink-100 rounded-lg overflow-hidden">
              {urls[s.side] ? (
                <a href={urls[s.side]} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urls[s.side]}
                    alt={s.label}
                    className="w-full h-full object-cover"
                  />
                </a>
              ) : errs[s.side] ? (
                <div className="w-full h-full grid place-items-center text-[10px] text-red-700 p-2 text-center">
                  {errs[s.side]}
                </div>
              ) : (
                <div className="w-full h-full grid place-items-center text-xs text-ink-400">
                  Načítám…
                </div>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

function labelFormat(f?: string): string {
  switch (f) {
    case "QR_CODE": return "QR";
    case "CODE_128": return "Code 128";
    case "CODE_39": return "Code 39";
    case "EAN_13": return "EAN-13";
    case "EAN_8": return "EAN-8";
    default: return f ?? "—";
  }
}

function formatCardNumber(n: string): string {
  return n.replace(/(.{4})/g, "$1 ").trim();
}

/** Convert 0xAARRGGBB Android Int → CSS rgb(...). Vrací undefined pro 0/null. */
function colorFromArgb(c?: number): string | undefined {
  if (!c) return undefined;
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `linear-gradient(135deg, rgb(${r},${g},${b}), rgba(${r},${g},${b},0.7))`;
}
