"use client";

import { useEffect, useRef, useState } from "react";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import {
  getCurrentProfileId,
  setCurrentProfileId,
  Profile,
  ProfileData,
} from "@/lib/profile-store";

export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentIdState] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        const raw = res.entities["profiles"] ?? [];
        const list: Profile[] = raw
          .filter((e) => !e.deletedAt)
          .map((e) => {
            const d = e.data as Record<string, unknown>;
            return {
              id: typeof d.id === "number" ? (d.id as number) : 0,
              syncId: e.syncId,
              data: d as unknown as ProfileData,
            };
          })
          .filter((p) => p.id > 0);
        setProfiles(list);

        // Auto-select první profil, pokud není nic uloženo nebo uloženo neexistuje
        const existing = getCurrentProfileId();
        const existsInList = list.some((p) => p.id === existing);
        if (!existsInList && list.length > 0) {
          setCurrentProfileId(list[0].id);
          setCurrentIdState(list[0].id);
        } else {
          setCurrentIdState(existing);
        }
      } catch {
        // Layout už chytá auth chyby — sem jen pro ukládání
      }
    })();
  }, []);

  // Zavři dropdown při kliknutí mimo
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function choose(id: number) {
    setCurrentProfileId(id);
    setCurrentIdState(id);
    setOpen(false);
  }

  const current = profiles.find((p) => p.id === currentId);

  if (profiles.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-ink-500">Žádné profily</div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 px-3 py-2 text-sm"
      >
        <div
          className="w-6 h-6 rounded-full grid place-items-center text-xs"
          style={{ backgroundColor: profileColor(current?.data) }}
        >
          {current?.data?.icon || "👤"}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="font-medium text-ink-900 truncate">
            {current?.data?.name ?? "Profil"}
          </div>
          {current?.data?.isBusiness && (
            <div className="text-[10px] uppercase text-ink-500">firemní</div>
          )}
          {current?.data?.isGroup && (
            <div className="text-[10px] uppercase text-ink-500">skupina</div>
          )}
        </div>
        <span className="text-ink-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-ink-200 bg-white shadow-lg max-h-80 overflow-auto">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => choose(p.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                p.id === currentId ? "bg-brand-50 text-brand-700" : "text-ink-900"
              }`}
            >
              <div
                className="w-6 h-6 rounded-full grid place-items-center text-xs"
                style={{ backgroundColor: profileColor(p.data) }}
              >
                {p.data.icon || "👤"}
              </div>
              <div className="flex-1 min-w-0 truncate">{p.data.name}</div>
              {p.id === currentId && <span className="text-brand-600">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function profileColor(d?: ProfileData): string {
  if (!d?.color) return "#E5E7EB";
  // Android Color.Int (0xAARRGGBB) → CSS
  const n = d.color >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b}, 0.3)`;
}
