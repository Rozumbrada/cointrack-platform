"use client";

import { ServerCategory } from "@/lib/sync-types";

export interface DonutSegment {
  cid: string;
  amount: number;
  category?: ServerCategory;
}

export function ExpenseDonut({
  segments,
  total,
  size = 180,
  stroke = 32,
}: {
  segments: DonutSegment[];
  total: number;
  size?: number;
  stroke?: number;
}) {
  if (total === 0 || segments.length === 0) return null;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#f1f5f9"
        strokeWidth={stroke}
      />
      {segments.map((s) => {
        const len = (s.amount / total) * circ;
        const dasharray = `${len} ${circ - len}`;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle
            key={s.cid}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={categoryColor(s.category, s.cid)}
            strokeWidth={stroke}
            strokeDasharray={dasharray}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
      <text
        x={size / 2}
        y={size / 2 - 4}
        textAnchor="middle"
        className="text-xs fill-ink-500"
      >
        Celkem
      </text>
      <text
        x={size / 2}
        y={size / 2 + 14}
        textAnchor="middle"
        className="text-sm font-semibold fill-ink-900"
      >
        {fmtCurrency(total)}
      </text>
    </svg>
  );
}

export function categoryColor(cat: ServerCategory | undefined, fallbackKey: string): string {
  if (cat?.color) {
    const n = cat.color >>> 0;
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const hash = Array.from(fallbackKey).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 0,
  }).format(amount);
}
