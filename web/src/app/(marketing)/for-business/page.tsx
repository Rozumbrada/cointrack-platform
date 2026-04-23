import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pro firmy a OSVČ",
  description:
    "Cointrack pro OSVČ, s.r.o. a živnostníky. Napojení na iDoklad, Fio platby, export pro účetní, předpřipravené kategorie podle oboru.",
};

const focuses = [
  { name: "Gastronomie a restaurace", categories: "Suroviny, nápoje, personál, energie, vybavení kuchyně" },
  { name: "IT a software", categories: "Licence, cloud, hardware, subdodavatelé, marketing" },
  { name: "Zdravotnictví", categories: "Laboratoř, zdravotnický materiál, léky, pronájem ordinace" },
  { name: "Stavebnictví", categories: "Materiál, nářadí, PHM, OOPP, pronájem techniky" },
  { name: "Maloobchod a e-shop", categories: "Zboží, logistika, obaly, marketing, pronájem" },
  { name: "Poradenství a právní", categories: "Odborná literatura, pojistné, cestovné, konference" },
  { name: "Zemědělství", categories: "Osivo, PHM, opravy strojů, veterinář, pojištění" },
  { name: "Vzdělávání", categories: "Studijní materiály, pronájem prostor, honoráře lektorů" },
  { name: "Reality", categories: "Opravy, pojistné, daně, energie, správa" },
  { name: "Doprava a logistika", categories: "PHM, servis, mýto, pojistné, leasing" },
];

export default function ForBusinessPage() {
  return (
    <>
      <section className="pt-20 pb-16">
        <Container>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-3 py-1 text-sm text-white mb-6">
              Cointrack Business
            </div>
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              Přestaň zápasit s fakturami a Excelem.
            </h1>
            <p className="mt-6 text-xl text-ink-600 leading-relaxed">
              Pro OSVČ, s.r.o. a živnostníky. Nasken účtenku, vystav fakturu, pošli účetní.
              Všechno v jedné appce, propojené s tvou bankou a iDokladem.
            </p>
            <div className="mt-10">
              <Button asChild variant="brand" size="lg">
                <Link href="/signup">14 dní zdarma</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* Use cases */}
      <section className="py-16 bg-white border-y border-ink-200">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-12">
            Co Cointrack dělá za tebe.
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <UseCase
              title="Ráno otevřeš accouny, večer fakturu"
              text="Transakce z ČSOB, KB nebo Fio se stáhly samy. Účtenky z oběda jsi vyfotil během 5 sekund. Fakturu pro klienta vystavíš na cestě domů."
            />
            <UseCase
              title="Účetní dostane ZIP pro kvartál"
              text="Export všech faktur (přijatých + vydaných) a účtenek v ZIP. Součástí je CSV s VS, IČO, částkami a linky na PDF. Účetní volá jen když něco chybí."
            />
            <UseCase
              title="Platby z faktur napřímo"
              text="Faktura přijde, klikneš Zaplatit, Fio API pošle platbu. Autorizuješ v Smartbanking SMS nebo push. Žádné kopírování IBAN a VS."
            />
            <UseCase
              title="Víš kolik máš v kase za hodinu"
              text="Dashboard ukáže, kolik tento měsíc přišlo od klientů, kolik jsi vydal za zboží, a jaké jsou nadcházející splatnosti."
            />
          </div>
        </Container>
      </section>

      {/* Business focuses */}
      <section className="py-20">
        <Container>
          <div className="max-w-2xl mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-4">
              Přednastavené kategorie podle tvého oboru.
            </h2>
            <p className="text-ink-600">
              Když zakládáš firemní profil, zvolíš zaměření. Cointrack naseje relevantní
              kategorie výdajů i příjmů, takže nemusíš nic vymýšlet.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {focuses.map((focus) => (
              <div
                key={focus.name}
                className="rounded-xl border border-ink-200 bg-white p-5"
              >
                <h3 className="font-semibold text-ink-900 mb-1">{focus.name}</h3>
                <p className="text-sm text-ink-600">{focus.categories}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Integrations */}
      <section className="py-20 bg-white border-t border-ink-200">
        <Container>
          <div className="max-w-2xl mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-4">
              Integrace, které skutečně použiješ.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Integration
              name="iDoklad"
              description="ClientID a ClientSecret z iDoklad dashboardu, vše ostatní řeší Cointrack. Vystav fakturu, pošli do iDokladu, stáhni PDF."
            />
            <Integration
              name="Fio API"
              description="Token z Fio internetového bankovnictví. Čtení transakcí i zadávání plateb. Autorizace v Smartbanking."
            />
            <Integration
              name="PSD2 Open Banking"
              description="ČSOB, KB, ČS, Air Bank, Raiffeisen, UniCredit, mBank a dalších 2500+. Přes regulované AIS poskytovatele."
            />
            <Integration
              name="ARES"
              description="Napiš IČO, ARES vrátí název, adresu, DIČ. Vyplnění firemních údajů za 2 sekundy."
            />
            <Integration
              name="Pohoda XML"
              description="Export účtenek a faktur ve formátu pro Pohoda účetní software. Všechno, co je třeba pro daňové přiznání."
            />
            <Integration
              name="Google Drive"
              description="Automatické zálohy v AES-256-GCM šifrování. Export účetních dokladů do oddělené složky pro sdílení s účetní."
            />
          </div>
        </Container>
      </section>

      {/* Pricing CTA */}
      <section className="py-24">
        <Container>
          <div className="rounded-3xl bg-ink-900 p-12 md:p-16">
            <div className="max-w-2xl">
              <h2 className="text-4xl font-semibold text-white tracking-tight">
                Business 199 Kč / měsíc.
              </h2>
              <p className="mt-4 text-lg text-ink-300">
                Neomezený počet firemních profilů, všechny integrace, sdílený přístup pro
                účetního, priority podpora.
              </p>
              <ul className="mt-6 space-y-2">
                {[
                  "14 dní zdarma, bez karty",
                  "Měsíční platba, zruš kdykoli",
                  "Česká podpora v češtině",
                  "GDPR + data v ČR",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-white">
                    <Check size={18} className="text-brand-400 shrink-0 mt-1" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button asChild variant="brand" size="lg">
                  <Link href="/signup">Vyzkoušet zdarma</Link>
                </Button>
                <Button asChild variant="ghost" size="lg" className="text-white hover:bg-ink-800">
                  <Link href="/pricing">Všechny tiery →</Link>
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function UseCase({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-xl font-semibold text-ink-900 mb-2">{title}</h3>
      <p className="text-ink-600 leading-relaxed">{text}</p>
    </div>
  );
}

function Integration({ name, description }: { name: string; description: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <h3 className="font-semibold text-ink-900 mb-2">{name}</h3>
      <p className="text-sm text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}
