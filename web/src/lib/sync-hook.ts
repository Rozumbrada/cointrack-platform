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
        .filter((e) => !e.deletedAt)
        .filter((e) => {
          if (alwaysGlobal) return true;
          if (profileSyncId == null) return true;
          const pid = (e.data as Record<string, unknown>).profileId;
          if (pid == null) return true;          // entity bez profileId (např. profiles samotné) → vše
          return pid === profileSyncId;          // string === string
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

  return {
    loading,
    error,
    profileSyncId,
    reload: load,
    entitiesByProfile,
    rawEntities,
  };
}
