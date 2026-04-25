"use client";

/**
 * Renderuje ikonu kategorie. Server posílá Material Icons identifier
 * (např. "car_repair", "restaurant"), který v `<span class="material-icons">`
 * vykreslí jako symbol pomocí Google fontu loaděného v root layoutu.
 * Pokud je hodnota emoji nebo cokoli jiného, vykreslí se jako text.
 */
export function CategoryIcon({
  name,
  size = "md",
  className = "",
}: {
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!name) return <span className={className}>📂</span>;
  const isMaterial = /^[a-z0-9_]+$/.test(name);
  if (isMaterial) {
    const px = size === "sm" ? 16 : size === "lg" ? 28 : 20;
    return (
      <span
        className={`material-icons ${className}`}
        style={{ fontSize: `${px}px`, lineHeight: 1 }}
      >
        {name}
      </span>
    );
  }
  return <span className={className}>{name}</span>;
}

export function colorFromInt(c?: number, alpha = 0.2): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function colorFromIntSolid(c?: number): string {
  if (!c) return "#9E9E9E";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}
