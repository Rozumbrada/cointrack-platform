import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "./Logo";
import { Container } from "@/components/ui/container";
import { SITE } from "@/lib/utils";

export async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  const groups = [
    {
      title: t("product"),
      links: [
        { href: "/features", label: t("feature_features") },
        { href: "/pricing", label: t("feature_pricing") },
        { href: "/for-business", label: t("feature_for_business") },
        { href: "/download", label: t("feature_download") },
      ],
    },
    {
      title: t("company"),
      links: [
        { href: "/about", label: t("company_about") },
        { href: "/contact", label: t("company_contact") },
        { href: "https://status.cointrack.cz", label: t("company_status") },
      ],
    },
    {
      title: t("legal"),
      links: [
        { href: "/privacy", label: t("legal_privacy") },
        { href: "/terms", label: t("legal_terms") },
        { href: "/cookies", label: t("legal_cookies") },
      ],
    },
  ];

  return (
    <footer className="border-t border-ink-200 bg-white mt-24">
      <Container className="py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1 space-y-3">
            <Logo />
            <p className="text-sm text-ink-600 max-w-xs">{t("tagline")}</p>
            <p className="text-sm text-ink-500">
              <a href={`mailto:${SITE.supportEmail}`} className="hover:text-ink-900">
                {SITE.supportEmail}
              </a>
            </p>
          </div>
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-ink-900 mb-3">{group.title}</h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-600 hover:text-ink-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-8 border-t border-ink-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <p className="text-sm text-ink-500">{t("copyright", { year })}</p>
          <p className="text-xs text-ink-400">{t("psd2_disclaimer")}</p>
        </div>
      </Container>
    </footer>
  );
}
