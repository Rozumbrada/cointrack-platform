"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  accountShares,
  ApiError,
  ShareWithAccountDto,
  auth,
  UserDto,
} from "@/lib/api";
import { withAuth, getAccessToken } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount, ServerCategory } from "@/lib/sync-types";
import {
  getCurrentProfileSyncId,
  getCachedProfileType,
  setCachedProfileType,
} from "@/lib/profile-store";

type Role = "VIEWER" | "EDITOR" | "ACCOUNTANT";

interface MemberGroup {
  email: string;
  role: Role;
  status: "active" | "pending" | "revoked";
  userDisplayName?: string | null;
  shares: ShareWithAccountDto[]; // všechny shares pro tento email
  /** Spojený filter z prvního share — předpokládáme, že shares jednoho člena mají stejný filter. */
  visibilityIncome: boolean;
  visibilityExpenses: boolean;
  visibilityCategories: string[] | null;
}

export default function MembersPage() {
  const t = useTranslations("members_page");
  const [shares, setShares] = useState<ShareWithAccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberGroup | null>(null);

  const [activeProfileSyncId, setActiveProfileSyncId] = useState<string | null>(null);
  const [activeProfileType, setActiveProfileType] = useState<string | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const { entitiesByProfile, rawEntities } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const categories = entitiesByProfile<ServerCategory>("categories");

  // Aktuální profil — typ + name. Typ čteme primárně z localStorage cache
  // (sjednoceno s layoutem `cointrack_profileTypeBySyncId`), abychom byli
  // konzistentní napříč komponentami. Pokud je cache prázdná, fallback na
  // rawEntities (= sync.pull data v useSyncData hook). Druhý fallback navíc
  // cache aktualizuje pro budoucí use.
  useEffect(() => {
    function refresh() {
      const syncId = getCurrentProfileSyncId();
      setActiveProfileSyncId(syncId);

      // Primární zdroj: cache
      const cachedType = getCachedProfileType(syncId);

      // Sekundární zdroj: sync data (může mít čerstvější info)
      const profile = rawEntities("profiles").find((e) => e.syncId === syncId);
      const data = profile?.data as Record<string, unknown> | undefined;
      const dataType = data?.type;
      const name = data?.name;

      // Preferujeme dataType (čerstvější), fallback na cachedType
      const finalType =
        typeof dataType === "string" ? dataType : cachedType;
      // Updatuje cache aby layout dostal správnou hodnotu
      if (typeof dataType === "string" && syncId) {
        setCachedProfileType(syncId, dataType);
      }

      setActiveProfileType(finalType);
      setActiveProfileName(typeof name === "string" ? name : null);
    }
    refresh();
    window.addEventListener("cointrack:profile-changed", refresh);
    window.addEventListener("cointrack:profile-type-changed", refresh);
    return () => {
      window.removeEventListener("cointrack:profile-changed", refresh);
      window.removeEventListener("cointrack:profile-type-changed", refresh);
    };
  }, [rawEntities]);

  const isOrganizationalProfile =
    activeProfileType === "BUSINESS" || activeProfileType === "ORGANIZATION";

  // Filtrace shares podle aktivního profilu — vlastník vidí jen členy,
  // které pozval pro účty patřící zvolenému profilu.
  const filteredShares = useMemo(() => {
    if (!activeProfileSyncId) return shares;
    return shares.filter((s) => s.profileSyncId === activeProfileSyncId);
  }, [shares, activeProfileSyncId]);

  // Seskupit shares podle emailu — "člen" = jeden email s N účty
  const memberGroups: MemberGroup[] = useMemo(() => {
    const map = new Map<string, MemberGroup>();
    for (const s of filteredShares) {
      const key = s.email.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.shares.push(s);
        // Pokud mix rolí, prefer ACCOUNTANT > EDITOR > VIEWER (vyšší práva)
        const order = { ACCOUNTANT: 3, EDITOR: 2, VIEWER: 1 } as const;
        if ((order[s.role as Role] ?? 0) > (order[existing.role] ?? 0)) {
          existing.role = s.role as Role;
        }
        // Status: aktivní pokud aspoň jedna aktivní
        if (s.status === "active") existing.status = "active";
        if (s.userDisplayName && !existing.userDisplayName) {
          existing.userDisplayName = s.userDisplayName;
        }
      } else {
        map.set(key, {
          email: s.email,
          role: s.role as Role,
          status: s.status as "active" | "pending" | "revoked",
          userDisplayName: s.userDisplayName,
          shares: [s],
          visibilityIncome: s.visibilityIncome,
          visibilityExpenses: s.visibilityExpenses,
          visibilityCategories: s.visibilityCategories,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
  }, [filteredShares]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await withAuth((tk) => accountShares.listOwned(tk));
      setShares(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      auth.me(token).then(setUser).catch(() => {});
    }
    load();
  }, []);

  const isOrganizationTier =
    user?.tier === "BUSINESS_PRO" || user?.tier === "ORGANIZATION";

  async function onRevokeAll(group: MemberGroup) {
    if (!confirm(t("revoke_all_confirm", { email: group.email }))) return;
    try {
      for (const s of group.shares) {
        await withAuth((tk) => accountShares.revoke(tk, s.id));
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const canManage = isOrganizationTier && isOrganizationalProfile;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
          {activeProfileName && (
            <p className="text-xs text-ink-500 mt-1">
              {t("for_profile")}: <span className="font-medium text-ink-700">{activeProfileName}</span>
            </p>
          )}
        </div>
        {canManage && (
          <button
            onClick={() => setShowInviteDialog(true)}
            disabled={accounts.length === 0}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {t("add_member")}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!isOrganizationTier && user && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h2 className="font-semibold text-amber-900 mb-2">{t("tier_required_title")}</h2>
          <p className="text-sm text-amber-900 mb-4">{t("tier_required_desc")}</p>
          <Link
            href="/app/upgrade"
            className="inline-block h-10 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium leading-[2.5rem]"
          >
            {t("go_upgrade")}
          </Link>
        </section>
      )}

      {/* Warning ukázat **jen** pokud profil je explicitně PERSONAL/GROUP.
          Legacy/null type = funguje normálně (data se stejně filtrují per-profil
          a pokud user opravdu nemůže, accounts list bude prázdný). */}
      {isOrganizationTier &&
        (activeProfileType === "PERSONAL" || activeProfileType === "GROUP") && (
        <section className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <h2 className="font-semibold text-blue-900 mb-2">{t("not_org_profile_title")}</h2>
          <p className="text-sm text-blue-900">{t("not_org_profile_desc")}</p>
        </section>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : memberGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2 max-w-md mx-auto">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_email")}</th>
                <th className="px-6 py-3 font-medium">{t("th_account")}</th>
                <th className="px-6 py-3 font-medium">{t("th_role")}</th>
                <th className="px-6 py-3 font-medium">{t("th_status")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {memberGroups.map((g) => (
                <tr key={g.email} className="hover:bg-ink-50/50 align-top">
                  <td className="px-6 py-3 text-ink-900">
                    {g.userDisplayName ? (
                      <div>
                        <div className="font-medium">{g.userDisplayName}</div>
                        <div className="text-ink-500 text-xs">{g.email}</div>
                      </div>
                    ) : (
                      g.email
                    )}
                  </td>
                  <td className="px-6 py-3 text-ink-700">
                    {g.role === "ACCOUNTANT" ? (
                      <span>
                        <span className="font-medium">{t("whole_profile")}:</span>{" "}
                        {g.shares[0]?.profileName}
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        {g.shares.map((s) => (
                          <div key={s.id}>
                            <span>{s.accountName}</span>
                            <span className="text-xs text-ink-400 ml-1.5">
                              ({s.accountCurrency} · {s.profileName})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
                      {g.role === "EDITOR"
                        ? t("role_editor")
                        : g.role === "ACCOUNTANT"
                          ? t("role_accountant")
                          : t("role_viewer")}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {g.status === "active" && (
                      <span className="text-emerald-700 text-xs font-medium">{t("status_active")}</span>
                    )}
                    {g.status === "pending" && (
                      <span className="text-amber-700 text-xs font-medium">{t("status_pending")}</span>
                    )}
                    {g.status === "revoked" && (
                      <span className="text-ink-500 text-xs">{t("status_revoked")}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditingMember(g)}
                      className="text-sm text-brand-600 hover:text-brand-700 font-medium mr-3"
                    >
                      {t("edit")}
                    </button>
                    <button
                      onClick={() => onRevokeAll(g)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      {t("revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInviteDialog && (
        <InviteDialog
          accounts={accounts}
          categories={categories}
          onClose={() => setShowInviteDialog(false)}
          onCreated={async () => {
            setShowInviteDialog(false);
            await load();
          }}
        />
      )}

      {editingMember && (
        <EditMemberDialog
          member={editingMember}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditingMember(null)}
          onSaved={async () => {
            setEditingMember(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({
  accounts,
  categories,
  onClose,
  onCreated,
}: {
  accounts: Array<{ syncId: string; data: ServerAccount }>;
  categories: Array<{ syncId: string; data: ServerCategory }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("members_page");
  const [email, setEmail] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    accounts.length > 0 ? new Set([accounts[0].syncId]) : new Set(),
  );
  const [role, setRole] = useState<Role>("VIEWER");
  const [visibilityIncome, setVisibilityIncome] = useState(true);
  const [visibilityExpenses, setVisibilityExpenses] = useState(true);
  const [visibilityCategories, setVisibilityCategories] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [accounts],
  );

  function toggleAccount(syncId: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(syncId)) next.delete(syncId);
      else next.add(syncId);
      return next;
    });
  }

  function selectAll() {
    setSelectedAccountIds(new Set(sortedAccounts.map((a) => a.syncId)));
  }

  function clearSelection() {
    setSelectedAccountIds(new Set());
  }

  const allSelected =
    sortedAccounts.length > 0 && selectedAccountIds.size === sortedAccounts.length;

  async function send() {
    if (!email.trim() || !email.includes("@")) {
      setErr(t("dialog_invalid_email"));
      return;
    }
    if (selectedAccountIds.size === 0) return;
    setSending(true);
    setErr(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const visibility = role === "ACCOUNTANT"
        ? undefined  // ACCOUNTANT vidí všechno, filtry se neaplikují
        : {
            visibilityIncome,
            visibilityExpenses,
            visibilityCategories,
          };
      for (const accountSyncId of selectedAccountIds) {
        await withAuth((tk) =>
          accountShares.invite(tk, accountSyncId, normalizedEmail, role, visibility),
        );
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-md w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold text-ink-900">{t("dialog_title")}</h2>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">{t("dialog_email")}</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            autoFocus
          />
        </label>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-medium text-ink-700">{t("dialog_accounts")}</div>
            {sortedAccounts.length > 0 && (
              <button
                type="button"
                onClick={allSelected ? clearSelection : selectAll}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                {allSelected ? t("dialog_unselect_all_accounts") : t("dialog_select_all_accounts")}
              </button>
            )}
          </div>
          {sortedAccounts.length === 0 ? (
            <p className="text-xs text-amber-700">{t("dialog_no_accounts")}</p>
          ) : (
            <div className="border border-ink-300 rounded-lg max-h-48 overflow-y-auto divide-y divide-ink-100">
              {sortedAccounts.map((a) => (
                <label
                  key={a.syncId}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.has(a.syncId)}
                    onChange={() => toggleAccount(a.syncId)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 text-ink-900">{a.data.name}</span>
                  <span className="text-xs text-ink-500">{a.data.currency}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <RolePicker role={role} setRole={setRole} />

        <VisibilityPicker
          role={role}
          categories={categories}
          income={visibilityIncome}
          setIncome={setVisibilityIncome}
          expenses={visibilityExpenses}
          setExpenses={setVisibilityExpenses}
          categoriesFilter={visibilityCategories}
          setCategoriesFilter={setVisibilityCategories}
        />

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{err}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            {t("dialog_cancel")}
          </button>
          <button
            onClick={send}
            disabled={sending || selectedAccountIds.size === 0}
            className="flex-1 h-10 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {sending ? t("dialog_sending") : t("dialog_send")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMemberDialog({
  member,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  member: MemberGroup;
  accounts: Array<{ syncId: string; data: ServerAccount }>;
  categories: Array<{ syncId: string; data: ServerCategory }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("members_page");

  // Server vrací u každého share `accountSyncId` (= klientský sync id),
  // takže můžeme přímo namapovat na checklist účtů.
  const initiallySelectedSyncIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of member.shares) {
      if (s.accountSyncId) set.add(s.accountSyncId);
    }
    return set;
  }, [member.shares]);

  const [selectedAccountIds, setSelectedAccountIds] =
    useState<Set<string>>(initiallySelectedSyncIds);
  const [role, setRole] = useState<Role>(member.role);
  const [visibilityIncome, setVisibilityIncome] = useState(member.visibilityIncome);
  const [visibilityExpenses, setVisibilityExpenses] = useState(member.visibilityExpenses);
  const [visibilityCategories, setVisibilityCategories] =
    useState<string[] | null>(member.visibilityCategories);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [accounts],
  );

  function toggleAccount(syncId: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(syncId)) next.delete(syncId);
      else next.add(syncId);
      return next;
    });
  }

  function selectAll() {
    setSelectedAccountIds(new Set(sortedAccounts.map((a) => a.syncId)));
  }

  function clearSelection() {
    setSelectedAccountIds(new Set());
  }

  const allSelected =
    sortedAccounts.length > 0 && selectedAccountIds.size === sortedAccounts.length;

  async function save() {
    if (selectedAccountIds.size === 0) {
      setErr(t("edit_select_at_least_one"));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const roleChanged = role !== member.role;
      const incomeChanged = visibilityIncome !== member.visibilityIncome;
      const expensesChanged = visibilityExpenses !== member.visibilityExpenses;
      const categoriesChanged =
        JSON.stringify(visibilityCategories ?? null) !==
        JSON.stringify(member.visibilityCategories ?? null);

      // 1) Update existující shares (role + visibility filter pokud se změnil)
      if (roleChanged || incomeChanged || expensesChanged || categoriesChanged) {
        const update: {
          role?: "VIEWER" | "EDITOR" | "ACCOUNTANT";
          visibilityIncome?: boolean;
          visibilityExpenses?: boolean;
          visibilityCategories?: string[] | null;
          resetVisibilityCategories?: boolean;
        } = {};
        if (roleChanged) update.role = role;
        if (incomeChanged) update.visibilityIncome = visibilityIncome;
        if (expensesChanged) update.visibilityExpenses = visibilityExpenses;
        if (categoriesChanged) {
          if (visibilityCategories === null) {
            update.resetVisibilityCategories = true;
          } else {
            update.visibilityCategories = visibilityCategories;
          }
        }
        for (const s of member.shares) {
          await withAuth((tk) => accountShares.updateShare(tk, s.id, update));
        }
      }

      // 2) Diff účtů
      const currentSyncIds = new Set(initiallySelectedSyncIds);
      const toAdd = [...selectedAccountIds].filter((sid) => !currentSyncIds.has(sid));
      const toRemove = [...currentSyncIds].filter((sid) => !selectedAccountIds.has(sid));

      // 3) Přidat shares pro nové účty (s aktuálním visibility filtrem)
      const visibility = role === "ACCOUNTANT"
        ? undefined
        : { visibilityIncome, visibilityExpenses, visibilityCategories };
      for (const accountSyncId of toAdd) {
        await withAuth((tk) =>
          accountShares.invite(tk, accountSyncId, member.email, role, visibility),
        );
      }

      // 4) Revoknout shares pro odebrané účty
      for (const sid of toRemove) {
        const share = member.shares.find((s) => s.accountSyncId === sid);
        if (share) {
          await withAuth((tk) => accountShares.revoke(tk, share.id));
        }
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-md w-full p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">{t("edit_dialog_title")}</h2>
          <p className="text-xs text-ink-600 mt-1">{member.email}</p>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-medium text-ink-700">{t("dialog_accounts")}</div>
            {sortedAccounts.length > 0 && (
              <button
                type="button"
                onClick={allSelected ? clearSelection : selectAll}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                {allSelected ? t("dialog_unselect_all_accounts") : t("dialog_select_all_accounts")}
              </button>
            )}
          </div>
          {sortedAccounts.length === 0 ? (
            <p className="text-xs text-amber-700">{t("dialog_no_accounts")}</p>
          ) : (
            <div className="border border-ink-300 rounded-lg max-h-48 overflow-y-auto divide-y divide-ink-100">
              {sortedAccounts.map((a) => (
                <label
                  key={a.syncId}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.has(a.syncId)}
                    onChange={() => toggleAccount(a.syncId)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 text-ink-900">{a.data.name}</span>
                  <span className="text-xs text-ink-500">{a.data.currency}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <RolePicker role={role} setRole={setRole} />

        <VisibilityPicker
          role={role}
          categories={categories}
          income={visibilityIncome}
          setIncome={setVisibilityIncome}
          expenses={visibilityExpenses}
          setExpenses={setVisibilityExpenses}
          categoriesFilter={visibilityCategories}
          setCategoriesFilter={setVisibilityCategories}
        />

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{err}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            {t("dialog_cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving || selectedAccountIds.size === 0}
            className="flex-1 h-10 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {saving ? t("edit_saving") : t("edit_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function VisibilityPicker({
  role,
  categories,
  income,
  setIncome,
  expenses,
  setExpenses,
  categoriesFilter,
  setCategoriesFilter,
}: {
  role: Role;
  categories: Array<{ syncId: string; data: ServerCategory }>;
  income: boolean;
  setIncome: (v: boolean) => void;
  expenses: boolean;
  setExpenses: (v: boolean) => void;
  categoriesFilter: string[] | null;
  setCategoriesFilter: (v: string[] | null) => void;
}) {
  const t = useTranslations("members_page");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ACCOUNTANT vidí všechno — visibility filtry se neaplikují.
  if (role === "ACCOUNTANT") {
    return (
      <div className="rounded-lg bg-ink-50 border border-ink-200 px-3 py-2 text-xs text-ink-700">
        {t("dialog_visibility_acct_warning")}
      </div>
    );
  }

  const sortedCategories = [...categories].sort((a, b) =>
    a.data.name.localeCompare(b.data.name),
  );

  const filterArray = categoriesFilter ?? [];
  const allCategoriesSelected =
    sortedCategories.length > 0 && filterArray.length === sortedCategories.length;

  function toggleCategory(syncId: string) {
    const next = new Set(filterArray);
    if (next.has(syncId)) next.delete(syncId);
    else next.add(syncId);
    if (next.size === 0) {
      setCategoriesFilter(null); // empty = všechny (default)
    } else {
      setCategoriesFilter([...next]);
    }
  }

  function selectAllCategories() {
    setCategoriesFilter(sortedCategories.map((c) => c.syncId));
  }

  function clearCategoriesFilter() {
    setCategoriesFilter(null);
  }

  return (
    <div>
      <div className="text-xs font-medium text-ink-700 mb-2">{t("dialog_visibility")}</div>
      <div className="flex gap-3 mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={income}
            onChange={(e) => setIncome(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm text-ink-900">{t("dialog_visibility_income")}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={expenses}
            onChange={(e) => setExpenses(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm text-ink-900">{t("dialog_visibility_expenses")}</span>
        </label>
      </div>

      {!income && !expenses && (
        <div className="text-xs text-amber-700 mb-2">
          {t("dialog_visibility_warn_nothing")}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
      >
        {advancedOpen ? "▾" : "▸"} {t("dialog_visibility_advanced")}
      </button>

      {advancedOpen && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs text-ink-600">{t("dialog_visibility_categories")}</div>
            {sortedCategories.length > 0 && (
              <button
                type="button"
                onClick={
                  allCategoriesSelected || filterArray.length > 0
                    ? clearCategoriesFilter
                    : selectAllCategories
                }
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                {filterArray.length > 0
                  ? t("dialog_visibility_clear_categories")
                  : t("dialog_visibility_select_all_categories")}
              </button>
            )}
          </div>
          {sortedCategories.length === 0 ? (
            <p className="text-xs text-amber-700">{t("dialog_visibility_no_categories")}</p>
          ) : (
            <div className="border border-ink-300 rounded-lg max-h-40 overflow-y-auto divide-y divide-ink-100">
              {sortedCategories.map((c) => (
                <label
                  key={c.syncId}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={filterArray.includes(c.syncId)}
                    onChange={() => toggleCategory(c.syncId)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 text-ink-900">{c.data.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RolePicker({
  role,
  setRole,
}: {
  role: Role;
  setRole: (r: Role) => void;
}) {
  const t = useTranslations("members_page");
  return (
    <div>
      <div className="text-xs font-medium text-ink-700 mb-2">{t("dialog_role")}</div>
      <div className="space-y-2">
        <label className="flex gap-2 p-3 rounded-lg border border-ink-200 hover:border-brand-300 cursor-pointer">
          <input
            type="radio"
            checked={role === "VIEWER"}
            onChange={() => setRole("VIEWER")}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-ink-900">{t("role_viewer")}</div>
            <div className="text-xs text-ink-600 mt-0.5">{t("dialog_role_viewer_desc")}</div>
          </div>
        </label>
        <label className="flex gap-2 p-3 rounded-lg border border-ink-200 hover:border-brand-300 cursor-pointer">
          <input
            type="radio"
            checked={role === "EDITOR"}
            onChange={() => setRole("EDITOR")}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-ink-900">{t("role_editor")}</div>
            <div className="text-xs text-ink-600 mt-0.5">{t("dialog_role_editor_desc")}</div>
          </div>
        </label>
        <label className="flex gap-2 p-3 rounded-lg border border-ink-200 hover:border-brand-300 cursor-pointer">
          <input
            type="radio"
            checked={role === "ACCOUNTANT"}
            onChange={() => setRole("ACCOUNTANT")}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-ink-900">{t("role_accountant")}</div>
            <div className="text-xs text-ink-600 mt-0.5">{t("dialog_role_accountant_desc")}</div>
          </div>
        </label>
      </div>
    </div>
  );
}
