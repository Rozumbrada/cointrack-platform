import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Mail, MessageSquare, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "Kontakt",
  description: "Napiš nám na support@cointrack.cz. Odpovídáme do 1 pracovního dne.",
};

export default function ContactPage() {
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-3xl">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-6">
            Kontakt.
          </h1>
          <p className="text-xl text-ink-600 mb-12">
            Nejjednodušší cesta je email. Odpovídáme do 1 pracovního dne, obvykle mnohem dřív.
          </p>

          <div className="grid gap-4">
            <ContactCard
              icon={Mail}
              title="Běžná podpora"
              email="support@cointrack.cz"
              description="Dotazy k používání, bug reporty, žádosti o funkce."
            />
            <ContactCard
              icon={MessageSquare}
              title="Obchodní dotazy"
              email="sales@cointrack.cz"
              description="Team tier, custom integrace, white-label řešení."
            />
            <ContactCard
              icon={Shield}
              title="Bezpečnost"
              email="security@cointrack.cz"
              description="Responsible disclosure bezpečnostních zranitelností. PGP klíč na vyžádání."
            />
          </div>

          <div className="mt-16 rounded-xl bg-ink-100 p-6">
            <h2 className="font-semibold text-ink-900 mb-2">Provozovatel</h2>
            <div className="text-sm text-ink-600 space-y-1">
              <p>Cointrack — provozovatel bude doplněn po registraci entity.</p>
              <p>Česká republika</p>
              <p>IČO: bude doplněno</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function ContactCard({
  icon: Icon, title, email, description,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  email: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-ink-200 bg-white p-5">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-ink-900">{title}</h3>
        <a
          href={`mailto:${email}`}
          className="text-brand-600 hover:text-brand-700 text-sm font-medium"
        >
          {email}
        </a>
        <p className="text-sm text-ink-600 mt-1">{description}</p>
      </div>
    </div>
  );
}
