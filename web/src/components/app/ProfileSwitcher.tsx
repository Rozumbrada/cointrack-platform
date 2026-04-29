"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { sync, accountShares } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import {
  getCurrentProfileSyncId,
  setCurrentProfileSyncId,
  Profile,
  ProfileData,
} from "@/lib/profile-store";

export default function ProfileSwitcher() {
  const t = useTranslations("profile_switcher");
  const tShare = useTranslations("profile_switcher_extras");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sharedProfileIds, setSharedProfileIds] = useState<Set<string>>(new Set());
  const [currentSyncId, setCurrentSyncIdState] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [res, mine] = await Promise.all([
          withAuth((t) => sync.pull(t)),
          withAuth((t) => accountShares.myShares(t)).catch(() => []),
        ]);
        const raw = res.entities["profiles"] ?? [];
        const list: Profile[] = raw
          .filter((e) => {
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
        setSharedProfileIds(new Set(mine.map((m) => m.profileId)));

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
          <div className="font-medium text-ink-900 truncate flex items-center gap-1.5">
            <span className="truncate">{current?.data?.name ?? t("default_label")}</span>
            {currentSyncId && sharedProfileIds.has(currentSyncId) && (
              <span
                title={tShare("shared_tooltip")}
                className="shrink-0 text-[9px] uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
              >
                🔗 {tShare("shared_badge")}
              </span>
            )}
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
                <div className="truncate flex items-center gap-1.5">
                  <span className="truncate">{p.data.name}</span>
                  {sharedProfileIds.has(p.syncId) && (
                    <span
                      title={tShare("shared_tooltip")}
                      className="shrink-0 text-[9px] uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
                    >
                      🔗
                    </span>
                  )}
                </div>
                <div className="text-[10px] uppercase text-ink-500">
                  {labelType(p.data.type, t)}
                </div>
              </div>
              {p.syncId === currentSyncId && (
                <span className="text-brand-600">✓</span>
              )}
            </button>
          ))}
          {/* Vždy přístupné — i když má user 1 profil, dropdown sloužil
              jen jako hluché info. Teď z něho vede správa profilů. */}
          <Link
            href="/app/profiles"
            onClick={() => setOpen(false)}
            className="block w-full px-3 py-2 text-sm text-brand-600 hover:bg-brand-50 border-t border-ink-100"
          >
            ⚙ {tShare("manage_profiles_action")}
          </Link>
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
