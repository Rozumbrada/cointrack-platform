import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "@/components/ui/container";
import { SITE } from "@/lib/utils";

const groups = [
  {
    title: "Produkt",
    links: [
      { href: "/features", label: "Funkce" },
      { href: "/pricing", label: "Ceník" },
      { href: "/for-business", label: "Pro firmy" },
      { href: "/download", label: "Stáhnout" },
    ],
  },
  {
    title: "Firma",
    links: [
      { href: "/about", label: "O nás" },
      { href: "/contact", label: "Kontakt" },
      { href: "https://status.cointrack.cz", label: "Status", external: true },
    ],
  },
  {
    title: "Právní",
    links: [
      { href: "/privacy", label: "Ochrana osobních údajů" },
      { href: "/terms", label: "Podmínky služby" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-ink-200 bg-white mt-24">
      <Container className="py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1 space-y-3">
            <Logo />
            <p className="text-sm text-ink-600 max-w-xs">
              Finanční asistent pro osobní i firemní účty. Android, iOS, web.
            </p>
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
          <p className="text-sm text-ink-500">
            © {year} Cointrack. Vaše data v České republice.
          </p>
          <p className="text-xs text-ink-400">
            Cointrack není banka ani platební instituce. Pro napojení bank používáme
            licencované PSD2 poskytovatele.
          </p>
        </div>
      </Container>
    </footer>
  );
}
