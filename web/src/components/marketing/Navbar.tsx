import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export async function Navbar() {
  const t = await getTranslations("header");
  const navItems = [
    { href: "/features", label: t("features") },
    { href: "/for-business", label: t("for_business") },
    { href: "/pricing", label: t("pricing") },
    { href: "/about", label: t("about") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-ink-50/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink-600 hover:text-ink-900 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{t("login")}</Link>
          </Button>
          <Button asChild variant="brand" size="sm">
            <Link href="/signup">{t("signup")}</Link>
          </Button>
        </div>
      </Container>
    </header>
  );
}
