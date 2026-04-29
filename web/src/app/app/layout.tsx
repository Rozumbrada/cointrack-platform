"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  clearAuth,
  getAccessToken,
  getStoredUser,
} from "@/lib/auth-store";
import { auth, sync, UserDto } from "@/lib/api";
import {
  getCurrentProfileSyncId,
  getCachedProfileType,
  setCachedProfileType,
} from "@/lib/profile-store";
import { tierDisplayName } from "@/lib/tier";
import ProfileSwitcher from "@/components/app/ProfileSwitcher";
import { QuickActionFab } from "@/components/app/QuickActionFab";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ts = useTranslations("sidebar");
  const tc = useTranslations("common");
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Init z localStorage cache — layout má od první frame správný typ
  // (pokud user už profil dříve používal). Bez cache by Členové menu
  // chvíli flickly do/z viditelnosti při každém načtení.
  // Normalizace na uppercase (legacy data můžou být lowercase 'personal' atd.).
  const [activeProfileType, setActiveProfileType] = useState<string | null>(
    () => {
      const cached = getCachedProfileType(getCurrentProfileSyncId());
      return cached ? cached.toUpperCase() : null;
    },
  );

  // Zavřít drawer při změně cesty
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Sledovat typ aktivního profilu — sekce Členové se zobrazuje
  // jen pro firemní/organizační profily (ne osobní/skupinové).
  // Závislost na `user` je důležitá: po přihlášení (= auth.me dorazí
  // a setUser proběhne) se efekt spustí znovu a typ se hned naplní.
  useEffect(() => {
    let cancelled = false;

    const reloadFromCache = () => {
      const syncId = getCurrentProfileSyncId();
      const cached = getCachedProfileType(syncId);
      // Normalizace na uppercase pro konzistentní compare (legacy cache)
      const normalized = cached ? cached.toUpperCase() : null;
      if (!cancelled) setActiveProfileType(normalized);
    };

    const loadProfileType = async () => {
      const token = getAccessToken();
      if (!token) return;
      const syncId = getCurrentProfileSyncId();
      if (!syncId) {
        if (!cancelled) setActiveProfileType(null);
        return;
      }
      try {
        const res = await sync.pull(token);
        for (const e of res.entities["profiles"] ?? []) {
          if (e.deletedAt) continue;
          const t = (e.data as Record<string, unknown>).type;
          // Normalizace: legacy data v DB mají lowercase 'personal' apod.,
          // standardizujeme na uppercase + fallback PERSONAL pro chybějící.
          const normalized = (typeof t === "string" && t.length > 0 ? t : "PERSONAL").toUpperCase();
          setCachedProfileType(e.syncId, normalized);
        }
        const profile = (res.entities["profiles"] ?? []).find(
          (e) => e.syncId === syncId && !e.deletedAt,
        );
        const type =
          (profile?.data as Record<string, unknown> | undefined)?.type;
        const normalized = (typeof type === "string" && type.length > 0 ? type : "PERSONAL").toUpperCase();
        if (!cancelled) setActiveProfileType(normalized);
      } catch {
        // ignore — sidebar i bez tohoto musí fungovat
      }
    };

    reloadFromCache();
    loadProfileType();

    const onProfileChange = () => {
      reloadFromCache();
      loadProfileType();
    };
    const onTypeChange = () => reloadFromCache();
    window.addEventListener("cointrack:profile-changed", onProfileChange);
    window.addEventListener("cointrack:profile-type-changed", onTypeChange);
    return () => {
      cancelled = true;
      window.removeEventListener("cointrack:profile-changed", onProfileChange);
      window.removeEventListener("cointrack:profile-type-changed", onTypeChange);
    };
  }, [pathname, user?.id]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const cached = getStoredUser();
    if (cached) setUser(cached);

    auth
      .me(token)
      .then((u) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        clearAuth();
        router.replace("/login");
      });
  }, [router]);

  async function onLogout() {
    const refreshToken =
      (typeof window !== "undefined" && localStorage.getItem("refreshToken")) ||
      "";
    try {
      if (refreshToken) await auth.logout(refreshToken);
    } catch {
      // ignore
    }
    clearAuth();
    router.replace("/login");
  }

  if (loading && !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-ink-50">
        <div className="text-ink-600 text-sm">{tc("loading")}</div>
      </div>
    );
  }

  // Profile selection nemá sidebar — zobrazí se jen content
  const isProfileSelection = pathname?.startsWith("/app/profiles");

  const isOrganizationTier =
    user?.tier === "BUSINESS_PRO" || user?.tier === "ORGANIZATION";
  // Členové: schováno **jen** když VÍME, že profil je PERSONAL nebo GROUP.
  // Pro BUSINESS / ORGANIZATION / null / cokoli jiného → ukázáno.
  // Cache fill (ProfileSwitcher i layout pull) doplní typ pro stávající
  // profily; pro PERSONAL/GROUP se schová okamžitě po naplnění.
  const profileIsExplicitlyNonBusiness =
    activeProfileType === "PERSONAL" || activeProfileType === "GROUP";
  const showMembers = isOrganizationTier && !profileIsExplicitlyNonBusiness;

  const nav: Array<{ href: string; label: string; section?: string }> = [
    { href: "/app/dashboard", label: ts("dashboard") },
    { href: "/app/accounts", label: ts("accounts") },
    { href: "/app/banks", label: ts("banks") },
    // Členové — jen pro firemní profil + Organization tier
    ...(showMembers
      ? [{ href: "/app/members", label: ts("members") }]
      : []),
    { href: "/app/transactions", label: ts("transactions") },
    { href: "/app/categories", label: ts("categories") },
    { href: "/app/statistics", label: ts("statistics") },
    { href: "/app/receipts", label: ts("receipts"), section: ts("section_documents") },
    { href: "/app/invoices", label: ts("invoices") },
    { href: "/app/idoklad", label: ts("idoklad") },
    { href: "/app/warranties", label: ts("warranties") },
    { href: "/app/loyalty-cards", label: ts("loyalty_cards") },
    { href: "/app/budgets", label: ts("budgets"), section: ts("section_planning") },
    { href: "/app/planned", label: ts("planned") },
    { href: "/app/debts", label: ts("debts") },
    { href: "/app/goals", label: ts("goals") },
    { href: "/app/shopping", label: ts("shopping") },
    { href: "/app/investments", label: ts("investments"), section: ts("section_assets") },
    { href: "/app/exchange-rates", label: ts("exchange_rates"), section: ts("section_tools") },
    { href: "/app/import", label: ts("import_csv") },
    { href: "/app/organizations", label: ts("organizations"), section: ts("section_social") },
    { href: "/app/upgrade", label: ts("upgrade"), section: ts("section_account") },
    { href: "/app/settings", label: ts("settings") },
  ];

  // Pro profile selection — minimální layout, bez navigace
  if (isProfileSelection) {
    return (
      <div className="min-h-screen bg-ink-50">
        <header className="h-14 md:h-16 bg-white border-b border-ink-200">
          <div className="max-w-6xl mx-auto h-full flex items-center justify-between gap-2 px-3 md:px-8">
            <Link
              href="/app"
              className="font-semibold text-ink-900 text-base md:text-lg shrink-0"
            >
              Cointrack
            </Link>
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <div className="text-xs text-ink-600 hidden md:block truncate max-w-[200px]">
                {user?.email}
              </div>
              <LocaleSwitcher />
              <button
                onClick={onLogout}
                className="shrink-0 text-sm text-ink-700 hover:text-ink-900 px-2 py-1 rounded-lg hover:bg-ink-100"
                aria-label={ts("logout")}
                title={ts("logout")}
              >
                <span className="hidden sm:inline">{ts("logout")}</span>
                <span className="sm:hidden text-base" aria-hidden="true">↪</span>
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto p-4 md:p-8">{children}</main>
      </div>
    );
  }

  // Standardní layout s nav menu vpravo
  return (
    <div className="min-h-screen bg-ink-50 flex flex-row-reverse">
      {/* Sidebar — vpravo, sticky aby zůstal viditelný při scrollu obsahu */}
      <aside className="w-64 bg-white border-l border-ink-200 hidden md:flex flex-col sticky top-0 h-screen self-start">
        <div className="h-16 flex items-center justify-between px-6 border-b border-ink-200">
          <Link href="/app/dashboard" className="font-semibold text-ink-900 text-lg">
            Cointrack
          </Link>
        </div>
        <div className="px-3 pt-3">
          <ProfileSwitcher />
          <Link
            href="/app/profiles"
            className="block mt-2 text-xs text-brand-600 hover:text-brand-700 px-2"
          >
            {ts("manage_profiles")}
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/app/dashboard" && pathname?.startsWith(item.href));
            return (
              <div key={item.href}>
                {item.section && (
                  <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    {item.section}
                  </div>
                )}
                <Link
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-700 hover:bg-ink-100"
                  }`}
                >
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-ink-200">
          <div className="px-3 py-2 text-xs text-ink-600">
            <div className="truncate font-medium text-ink-900">
              {user?.displayName || user?.email}
            </div>
            <div className="truncate">{user?.email}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
              {tierDisplayName(user?.tier)}
            </div>
          </div>
          <div className="px-3 pb-2">
            <LocaleSwitcher />
          </div>
          <button
            onClick={onLogout}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            {ts("logout")}
          </button>
        </div>
      </aside>

      {/* Main content — vlevo */}
      <main className="flex-1 min-w-0">
        <header className="md:hidden h-14 bg-white border-b border-ink-200 flex items-center justify-between gap-2 px-3 sticky top-0 z-30">
          <Link
            href="/app/dashboard"
            className="font-semibold text-ink-900 shrink-0"
          >
            Cointrack
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <LocaleSwitcher />
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-9 h-9 grid place-items-center rounded-lg hover:bg-ink-100"
              aria-label={ts("open_menu")}
            >
              <span className="block w-5 space-y-[5px]">
                <span className="block h-0.5 bg-ink-700 rounded" />
                <span className="block h-0.5 bg-ink-700 rounded" />
                <span className="block h-0.5 bg-ink-700 rounded" />
              </span>
            </button>
          </div>
        </header>

        <div className="max-w-6xl mx-auto p-3 md:p-8">{children}</div>
      </main>

      {/* Mobile drawer — slide-in zprava */}
      {drawerOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="md:hidden fixed top-0 right-0 z-50 h-screen w-72 bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
            <div className="h-14 flex items-center justify-between px-4 border-b border-ink-200">
              <span className="font-semibold text-ink-900">{ts("open_menu")}</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-ink-400 hover:text-ink-600 text-2xl leading-none w-8 h-8 grid place-items-center"
                aria-label={tc("close")}
              >
                ×
              </button>
            </div>
            <div className="px-3 pt-3">
              <ProfileSwitcher />
              <Link
                href="/app/profiles"
                className="block mt-2 text-xs text-brand-600 hover:text-brand-700 px-2"
              >
                {ts("manage_profiles")}
              </Link>
            </div>
            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {nav.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/app/dashboard" && pathname?.startsWith(item.href));
                return (
                  <div key={item.href}>
                    {item.section && (
                      <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        {item.section}
                      </div>
                    )}
                    <Link
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                        active
                          ? "bg-brand-50 text-brand-700"
                          : "text-ink-700 hover:bg-ink-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </div>
                );
              })}
            </nav>
            <div className="p-3 border-t border-ink-200">
              <div className="px-3 py-2 text-xs text-ink-600">
                <div className="truncate font-medium text-ink-900">
                  {user?.displayName || user?.email}
                </div>
                <div className="truncate">{user?.email}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
                  {tierDisplayName(user?.tier)}
                </div>
              </div>
              <div className="px-3 pb-2">
                <LocaleSwitcher />
              </div>
              <button
                onClick={onLogout}
                className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
              >
                {ts("logout")}
              </button>
            </div>
          </aside>
        </>
      )}

      <QuickActionFab />
    </div>
  );
}
