/**
 * Sdílený hook pro pull všech entit + filtrování podle currentProfileId.
 * Odstraní duplication mezi stránkami (každá potřebuje sync.pull + filter by profile).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { sync, SyncEntity, SyncPullResponse } from "./api";
import { withAuth } from "./auth-store";
import { getCurrentProfileId } from "./profile-store";

export function useSyncData() {
  const [data, setData] = useState<SyncPullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);

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
    setProfileId(getCurrentProfileId());

    const onProfileChange = () => setProfileId(getCurrentProfileId());
    window.addEventListener("cointrack:profile-changed", onProfileChange);
    return () => window.removeEventListener("cointrack:profile-changed", onProfileChange);
  }, [load]);

  /** Získá entity daného typu filtrované podle aktuálního profilu. */
  const entitiesByProfile = useCallback(
    <T,>(key: string, alwaysGlobal = false): Array<{ syncId: string; data: T }> => {
      if (!data) return [];
      const all = data.entities[key] ?? [];
      return all
        .filter((e) => !e.deletedAt)
        .filter((e) => {
          if (alwaysGlobal) return true;
          if (profileId == null) return true;
          const pid = (e.data as Record<string, unknown>).profileId;
          return pid == null || pid === profileId;
        })
        .map((e) => ({ syncId: e.syncId, data: e.data as unknown as T }));
    },
    [data, profileId],
  );

  /** Raw entities (bez filter) — pro profiles, organizations apod. */
  const rawEntities = useCallback(
    (key: string): SyncEntity[] => {
      if (!data) return [];
      return (data.entities[key] ?? []).filter((e) => !e.deletedAt);
    },
    [data],
  );

  return {
    loading,
    error,
    profileId,
    reload: load,
    entitiesByProfile,
    rawEntities,
  };
}
