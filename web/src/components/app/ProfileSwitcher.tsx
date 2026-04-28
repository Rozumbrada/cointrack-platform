"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import {
  getCurrentProfileSyncId,
  setCurrentProfileSyncId,
  Profile,
  ProfileData,
} from "@/lib/profile-store";

export default function ProfileSwitcher() {
  const t = useTranslations("profile_switcher");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentSyncId, setCurrentSyncIdState] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        const raw = res.entities["profiles"] ?? [];
        const list: Profile[] = raw
          .filter((e) => {
            // Smazané profily: envelope.deletedAt NEBO data.deletedAt
            if (e.deletedAt) return false;
            const d = e.data as Record<string, unknown>;
            if (d.deletedAt != null && d.deletedAt !== 0) return false;
            return true;
          })
          .map((e) => ({
            syncId: e.syncId,
            data: e.data as unknown as ProfileData,
          }))
          .sort((a, b) => a.data.name.localeCompare(b.data.name));
        setProfiles(list);

        // Auto-select: pokud není nic uloženo nebo uloženo neexistuje v aktuálním seznamu
        const existing = getCurrentProfileSyncId();
        const existsInList = list.some((p) => p.syncId === existing);
        if (!existsInList && list.length > 0) {
          setCurrentProfileSyncId(list[0].syncId);
          setCurrentSyncIdState(list[0].syncId);
        } else {
          setCurrentSyncIdState(existing);
        }
      } catch {
        // Layout se postará o 401
      }
    })();
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function choose(syncId: string) {
    setCurrentProfileSyncId(syncId);
    setCurrentSyncIdState(syncId);
    setOpen(false);
  }

  const current = profiles.find((p) => p.syncId === currentSyncId);

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-300 px-3 py-2 text-xs text-ink-500 text-center">
        {t("loading")}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 px-3 py-2 text-sm"
      >
        <div
          className="w-7 h-7 rounded-full grid place-items-center text-xs shrink-0"
          style={{ backgroundColor: profileColor(current?.data) }}
        >
          {current?.data?.icon || "👤"}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="font-medium text-ink-900 truncate">
            {current?.data?.name ?? t("default_label")}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-500">
            {labelType(current?.data?.type, t)}
          </div>
        </div>
        <span className="text-ink-400 text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-ink-200 bg-white shadow-lg max-h-80 overflow-auto">
          {profiles.map((p) => (
            <button
              key={p.syncId}
              onClick={() => choose(p.syncId)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                p.syncId === currentSyncId
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-900"
              }`}
            >
              <div
                className="w-6 h-6 rounded-full grid place-items-center text-xs"
                style={{ backgroundColor: profileColor(p.data) }}
              >
                {p.data.icon || "👤"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate">{p.data.name}</div>
                <div className="text-[10px] uppercase text-ink-500">
                  {labelType(p.data.type, t)}
                </div>
              </div>
              {p.syncId === currentSyncId && (
                <span className="text-brand-600">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function labelType(type: string | undefined, t: (k: string) => string): string {
  switch (type) {
    case "BUSINESS":
    case "B2B":
      return t("type_business");
    case "GROUP":
      return t("type_group");
    case "PERSONAL":
      return t("type_personal");
    default:
      return type ?? "";
  }
}

function profileColor(d?: ProfileData): string {
  if (!d?.color) return "#E5E7EB";
  const n = d.color >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, 0.3)`;
}
