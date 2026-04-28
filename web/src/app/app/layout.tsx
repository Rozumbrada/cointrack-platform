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
import { auth, UserDto } from "@/lib/api";
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

  // Zavřít drawer při změně cesty
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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

  const nav: Array<{ href: string; label: string; section?: string }> = [
    { href: "/app/dashboard", label: ts("dashboard") },
    { href: "/app/accounts", label: ts("accounts") },
    { href: "/app/banks", label: ts("banks") },
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
        <header className="h-16 bg-white border-b border-ink-200">
          <div className="max-w-6xl mx-auto h-full flex items-center justify-between px-4 md:px-8">
            <Link href="/app" className="font-semibold text-ink-900 text-lg">
              Cointrack
            </Link>
            <div className="flex items-center gap-4">
              <div className="text-xs text-ink-600 hidden sm:block">
                {user?.email}
              </div>
              <LocaleSwitcher />
              <button
                onClick={onLogout}
                className="text-sm text-ink-700 hover:text-ink-900"
              >
                {ts("logout")}
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
              {user?.tier ?? "free"}
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
        <header className="md:hidden h-14 bg-white border-b border-ink-200 flex items-center justify-between px-4 sticky top-0 z-30">
          <Link href="/app/dashboard" className="font-semibold text-ink-900">
            Cointrack
          </Link>
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
        </header>

        <div className="max-w-6xl mx-auto p-4 md:p-8">{children}</div>
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
                Spravovat profily →
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
              </div>
              <button
                onClick={onLogout}
                className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
              >
                Odhlásit
              </button>
            </div>
          </aside>
        </>
      )}

      <QuickActionFab />
    </div>
  );
}
