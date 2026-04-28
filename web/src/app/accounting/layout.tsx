"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { auth, UserDto, api } from "@/lib/api";
import { clearAuth, getAccessToken, withAuth } from "@/lib/auth-store";

interface AccountantOrg {
  orgId: string;
  orgName: string;
  role: string;
}

export default function AccountantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("accounting_layout");
  const tc = useTranslations("common");
  const ts = useTranslations("sidebar");
  const [user, setUser] = useState<UserDto | null>(null);
  const [orgs, setOrgs] = useState<AccountantOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const me = await auth.me(token);
        setUser(me);
        const res = await withAuth((t) =>
          api<{ organizations: AccountantOrg[] }>("/api/v1/accounting/orgs", { token: t }),
        );
        setOrgs(res.organizations);
        setLoading(false);
      } catch {
        clearAuth();
        router.replace("/login");
      }
    })();
  }, [router]);

  async function onLogout() {
    const refresh = typeof window !== "undefined" ? localStorage.getItem("refreshToken") : null;
    try {
      if (refresh) await auth.logout(refresh);
    } catch {}
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

  if (!loading && orgs.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center bg-ink-50 px-6">
        <div className="max-w-lg bg-white rounded-2xl border border-ink-200 p-8 text-center">
          <div className="text-4xl mb-3">🧮</div>
          <h1 className="text-xl font-semibold text-ink-900 mb-2">
            {t("no_orgs_title")}
          </h1>
          <p className="text-sm text-ink-600 mb-6">{t("no_orgs_desc")}</p>
          <Link
            href="/app/dashboard"
            className="inline-block h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 grid place-items-center text-sm font-medium text-ink-900"
          >
            {t("back_to_app")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 flex">
      <aside className="w-64 bg-white border-r border-ink-200 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-ink-200">
          <Link href="/accounting" className="font-semibold text-ink-900 text-lg">
            Cointrack <span className="text-brand-600">{t("logo_suffix")}</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 px-3 py-1">
            {t("section_orgs")}
          </div>
          {orgs.map((o) => (
            <div key={o.orgId} className="rounded-lg overflow-hidden">
              <Link
                href={`/accounting/${o.orgId}/receipts`}
                className={`block px-3 py-2 text-sm font-medium ${
                  pathname?.startsWith(`/accounting/${o.orgId}/receipts`)
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-700 hover:bg-ink-100"
                }`}
              >
                {t("org_receipts", { name: o.orgName })}
              </Link>
              <Link
                href={`/accounting/${o.orgId}/invoices`}
                className={`block px-3 py-2 text-sm font-medium ${
                  pathname?.startsWith(`/accounting/${o.orgId}/invoices`)
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-700 hover:bg-ink-100"
                }`}
              >
                {t("org_invoices", { name: o.orgName })}
              </Link>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-ink-200">
          <div className="px-3 py-2 text-xs">
            <div className="font-medium text-ink-900 truncate">{user?.email}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mt-0.5">
              {t("role_accountant")}
            </div>
          </div>
          <Link
            href="/app/dashboard"
            className="block rounded-lg px-3 py-2 text-xs text-ink-600 hover:bg-ink-100"
          >
            {t("back_my_app")}
          </Link>
          <button
            onClick={onLogout}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            {ts("logout")}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
