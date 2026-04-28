import { Logo } from "@/components/marketing/Logo";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("footer");
  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      <header className="py-6">
        <div className="max-w-md mx-auto px-6 flex items-center justify-between">
          <Logo />
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="py-6 text-center text-sm text-ink-500">
        <Link href="/" className="hover:text-ink-700">{t("back_home")}</Link>
      </footer>
    </div>
  );
}
