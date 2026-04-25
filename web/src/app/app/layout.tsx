"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearAuth,
  getAccessToken,
  getStoredUser,
} from "@/lib/auth-store";
import { auth, UserDto } from "@/lib/api";
import ProfileSwitcher from "@/components/app/ProfileSwitcher";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

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
        <div className="text-ink-600 text-sm">Načítám…</div>
      </div>
    );
  }

  // Profile selection nemá sidebar — zobrazí se jen content
  const isProfileSelection = pathname?.startsWith("/app/profiles");

  const nav: Array<{ href: string; label: string; section?: string }> = [
    { href: "/app/dashboard", label: "Přehled" },
    { href: "/app/accounts", label: "Účty" },
    { href: "/app/transactions", label: "Transakce" },
    { href: "/app/categories", label: "Kategorie" },
    { href: "/app/statistics", label: "Statistiky" },
    { href: "/app/receipts", label: "Účtenky", section: "Doklady" },
    { href: "/app/invoices", label: "Faktury" },
    { href: "/app/warranties", label: "Záruky" },
    { href: "/app/budgets", label: "Rozpočty", section: "Plánování" },
    { href: "/app/planned", label: "Plánované platby" },
    { href: "/app/debts", label: "Dluhy" },
    { href: "/app/goals", label: "Cíle" },
    { href: "/app/shopping", label: "Nákupní seznamy" },
    { href: "/app/investments", label: "Investice", section: "Majetek" },
    { href: "/app/banks", label: "Banky" },
    { href: "/app/organizations", label: "Organizace a skupiny", section: "Sociální" },
    { href: "/app/settings", label: "Nastavení" },
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
              <button
                onClick={onLogout}
                className="text-sm text-ink-700 hover:text-ink-900"
              >
                Odhlásit
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
      {/* Sidebar — vpravo */}
      <aside className="w-64 bg-white border-l border-ink-200 hidden md:flex flex-col">
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
          <button
            onClick={onLogout}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            Odhlásit
          </button>
        </div>
      </aside>

      {/* Main content — vlevo */}
      <main className="flex-1 min-w-0">
        <header className="md:hidden h-14 bg-white border-b border-ink-200 flex items-center justify-between px-4">
          <Link href="/app/dashboard" className="font-semibold text-ink-900">
            Cointrack
          </Link>
          <button
            onClick={onLogout}
            className="text-sm text-ink-700"
            aria-label="Odhlásit"
          >
            Odhlásit
          </button>
        </header>

        {/* Mobile nav — horizontální scroll */}
        <div className="md:hidden bg-white border-b border-ink-200 overflow-x-auto">
          <div className="flex gap-1 px-3 py-2 whitespace-nowrap">
            <Link
              href="/app/profiles"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50"
            >
              Profily
            </Link>
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/app/dashboard" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-700 hover:bg-ink-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="max-w-6xl mx-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
