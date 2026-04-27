import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

export const metadata: Metadata = {
  title: "Ceník",
  description:
    "Free pro osobní použití, Business pro OSVČ a firmy. 14 dní zdarma na zkoušku, bez karty.",
};

type Tier = {
  name: string;
  price: string;
  period?: string;
  description: string;
  cta: string;
  ctaVariant: "outline" | "brand" | "primary";
  features: string[];
  missing?: string[];
  badge?: string;
};

const tiers: Tier[] = [
  {
    name: "Free",
    price: "0 Kč",
    description: "Pro osobní použití, lokálně na Androidu.",
    cta: "Stáhnout Android",
    ctaVariant: "outline",
    features: [
      "Jeden osobní profil",
      "Fio banka přes token",
      "OCR účtenek (vlastní Gemini API klíč)",
      "Offline provoz + Google Drive zálohy",
      "Kategorie, rozpočty, cíle",
      "Export do ZIP",
    ],
    missing: ["Cloud sync", "Web přístup", "Firemní profily"],
  },
  {
    name: "Personal",
    price: "69 Kč",
    period: "/měsíc",
    description: "Osobní profil napříč zařízeními (Android + web + iOS).",
    cta: "14 dní zdarma",
    ctaVariant: "primary",
    features: [
      "Vše z Free",
      "Cloud sync mezi Androidem, webem a iOS",
      "Napojení bank přes PSD2 (ČSOB, KB, ČS, Air Bank…)",
      "OCR účtenek bez vlastního API klíče",
      "Web aplikace (cointrack.cz/app)",
      "Priority podpora",
    ],
  },
  {
    name: "Business",
    price: "199 Kč",
    period: "/měsíc",
    description: "Pro OSVČ a s.r.o. Firemní profily.",
    cta: "14 dní zdarma",
    ctaVariant: "brand",
    badge: "Nejoblíbenější",
    features: [
      "Vše z Personal",
      "Neomezený počet firemních profilů",
      "Přednastavené kategorie dle oboru",
      "iDoklad integrace (vystavení faktur)",
      "Fio platby napřímo přes API",
      "Sdílený přístup pro účetního (read-only)",
      "Export do Pohoda XML",
      "ARES automatická doplnění firemních dat",
    ],
  },
  {
    name: "Organization",
    price: "399 Kč",
    period: "/měsíc",
    description: "Pro firmy s více členy a sdílenou účetní.",
    cta: "14 dní zdarma",
    ctaVariant: "brand",
    features: [
      "Vše z Business",
      "Pozvání více členů do organizace",
      "Sdílení jednotlivých bankovních účtů s členy",
      "Účetní rozhraní s hromadným ZIP exportem",
      "Per-uživatelské oprávnění na úrovni účtů",
      "API přístup pro vlastní integrace",
      "Priority podpora",
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="pt-20 pb-12">
        <Container>
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              Ceník, který nepřekvapí.
            </h1>
            <p className="mt-6 text-xl text-ink-600">
              Začni zdarma, plať měsíčně, zruš kdykoliv.
              Žádné smluvní pokuty, žádné aktivační poplatky.
            </p>
            <p className="mt-3 text-sm text-ink-500">
              Ceny jsou s DPH pro ČR. B2B ceny vidíš po zadání DIČ v checkoutu.
            </p>
          </div>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  tier.badge
                    ? "border-brand-600 bg-white shadow-lg"
                    : "border-ink-200 bg-white"
                }`}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    {tier.badge}
                  </div>
                )}

                <h3 className="text-lg font-semibold text-ink-900">{tier.name}</h3>
                <div className="mt-3 mb-1">
                  <span className="text-4xl font-semibold text-ink-900">{tier.price}</span>
                  {tier.period && <span className="text-ink-500 ml-1">{tier.period}</span>}
                </div>
                <p className="text-sm text-ink-600 mb-6 min-h-[2.5rem]">{tier.description}</p>

                <Button asChild variant={tier.ctaVariant} className="w-full mb-6">
                  <Link href="/signup">{tier.cta}</Link>
                </Button>

                <ul className="space-y-3 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-3 text-sm">
                      <Check size={16} className="text-brand-600 shrink-0 mt-0.5" />
                      <span className="text-ink-700">{f}</span>
                    </li>
                  ))}
                  {tier.missing?.map((f) => (
                    <li key={f} className="flex gap-3 text-sm text-ink-400">
                      <X size={16} className="shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Yearly discount */}
          <div className="mt-8 rounded-xl bg-ink-100 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <p className="font-semibold text-ink-900">Platíš ročně? Dostaneš 2 měsíce zdarma.</p>
              <p className="text-sm text-ink-600 mt-1">Personal za 690 Kč/rok, Business za 1990 Kč/rok, Organization za 3990 Kč/rok.</p>
            </div>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-white border-t border-ink-200">
        <Container>
          <div className="max-w-3xl">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900 mb-12">
              Často kladené otázky
            </h2>
            <div className="space-y-8">
              <Faq
                q="Můžu zrušit kdykoliv?"
                a="Ano, v libovolném okamžiku přes Nastavení → Předplatné → Zrušit. Budeš mít přístup do konce zaplaceného období. Žádné pokuty, žádné formuláře."
              />
              <Faq
                q="Co se stane s daty, když downgraduju na Free?"
                a="Data zůstanou. Firemní profily přejdou do read-only režimu, takže si faktury pořád zobrazíš a exportuješ, ale nepřidáš nové. Kdykoli se vrátíš na Business, zase se odemknou."
              />
              <Faq
                q="Jak funguje 14-denní trial?"
                a="Registraci na Personal, Business nebo Organization ti dá plný přístup na 14 dní bez karty. V den 14 ti pošleme připomínku — pokud pokračuješ, přidáš kartu, jinak se přepneš automaticky na Free."
              />
              <Faq
                q="Je Cointrack registrovaný u ČNB?"
                a="Cointrack není platební instituce ani banka. Pro napojení bank přes PSD2 používáme licencované AIS poskytovatele (GoCardless Bank Account Data, Enable Banking), které drží licenci v EU."
              />
              <Faq
                q="Kde běží servery?"
                a="WEDOS (Hluboká nad Vltavou, Česká republika) pro databázi a soubory. Web je na Vercel edge (Frankfurt). Zálohy na Backblaze B2 v EU. Žádná data neopouštějí Evropskou unii."
              />
              <Faq
                q="Jaký rozdíl mezi osobním a firemním profilem?"
                a="Osobní profil nemá DPH, nepotřebuje IČO, jde do Free. Firemní profil má IČO/DIČ, přednastavené kategorie dle oboru (pohostinství, IT, zdravotnictví…), integraci s iDoklad a Pohoda, a je součástí Business tieru."
              />
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-ink-900 mb-2">{q}</h3>
      <p className="text-ink-600 leading-relaxed">{a}</p>
    </div>
  );
}
