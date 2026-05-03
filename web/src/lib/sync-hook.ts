/**
 * Sdílený hook pro pull všech entit + filtrování podle aktuálního profilu (syncId / UUID).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { sync, SyncEntity, SyncPullResponse } from "./api";
import { withAuth } from "./auth-store";
import { getCurrentProfileSyncId } from "./profile-store";

export function useSyncData() {
  const [data, setData] = useState<SyncPullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileSyncId, setProfileSyncId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withAuth((t) => sync.pull(t));
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    setProfileSyncId(getCurrentProfileSyncId());

    const onProfileChange = () => setProfileSyncId(getCurrentProfileSyncId());
    window.addEventListener("cointrack:profile-changed", onProfileChange);
    return () =>
      window.removeEventListener("cointrack:profile-changed", onProfileChange);
  }, [load]);

  /**
   * Získá entity daného typu filtrované podle aktuálního profilu.
   * Backend serializuje profileId jako UUID string (= syncId profilu).
   */
  const entitiesByProfile = useCallback(
    <T,>(key: string, alwaysGlobal = false): Array<{ syncId: string; data: T }> => {
      if (!data) return [];
      const all = data.entities[key] ?? [];
      return all
        .filter((e) => {
          if (e.deletedAt) return false;
          const d = e.data as Record<string, unknown>;
          if (d.deletedAt != null && d.deletedAt !== 0) return false;
          return true;
        })
        .filter((e) => {
          if (alwaysGlobal) return true;
          if (profileSyncId == null) return true;
          const pid = (e.data as Record<string, unknown>).profileId;
          if (pid == null) return true;          // entity bez profileId (např. profiles samotné) → vše
          return String(pid) === profileSyncId;  // trpí starý format (number) by se stejně nematchoval
        })
        .map((e) => ({ syncId: e.syncId, data: e.data as unknown as T }));
    },
    [data, profileSyncId],
  );

  /** Raw entities (bez filtering) — pro profiles, group_expense_items apod. */
  const rawEntities = useCallback(
    (key: string): SyncEntity[] => {
      if (!data) return [];
      return (data.entities[key] ?? []).filter((e) => !e.deletedAt);
    },
    [data],
  );

  /** Diagnostika — kolik entit je v daném typu celkem vs. po filter by profile. */
  const diagnose = useCallback(
    (key: string): { total: number; matched: number; otherProfiles: Set<string> } => {
      if (!data) return { total: 0, matched: 0, otherProfiles: new Set() };
      const all = (data.entities[key] ?? []).filter((e) => !e.deletedAt);
      const matched = entitiesByProfile(key).length;
      const otherProfiles = new Set<string>();
      all.forEach((e) => {
        const pid = (e.data as Record<string, unknown>).profileId;
        if (pid != null && String(pid) !== profileSyncId) {
          otherProfiles.add(String(pid));
        }
      });
      return { total: all.length, matched, otherProfiles };
    },
    [data, profileSyncId, entitiesByProfile],
  );

  return {
    loading,
    error,
    profileSyncId,
    reload: load,
    entitiesByProfile,
    rawEntities,
    diagnose,
    /** Metadata o přístupech — používá dashboard pro omezení na sdílené účty. */
    accessControl: data?.accessControl,
  };
}
