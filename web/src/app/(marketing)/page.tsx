import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  CreditCard, ReceiptText, ScanLine, LineChart, ShieldCheck,
  Smartphone, Building2, Sparkles,
} from "lucide-react";

export default function HomePage() {
  return (
    <>
      {/* ─── HERO ───────────────────────────────────────────────────── */}
      <section className="pt-16 pb-20 md:pt-20 md:pb-24">
        <Container>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-700 mb-6">
                <Sparkles size={14} />
                <span>Beta — nové funkce každý týden</span>
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink-900 leading-[1.05]">
                Přestaň ručně přepisovat účtenky do Excelu.
              </h1>
              <p className="mt-6 text-lg md:text-xl text-ink-600 leading-relaxed">
                Cointrack sám stáhne transakce z tvé banky, vyfotí účtenky do systému
                a spočítá, kolik jsi utratil za benzín. Pro osobní rozpočet i
                firemní účetnictví.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Button asChild variant="brand" size="lg">
                  <Link href="/signup">Vyzkoušet zdarma 14 dní</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/features">Jak to funguje</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-ink-500">
                Bez karty na začátek. Android, web, iOS v přípravě.
              </p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <PhoneFrame
                src="/screenshots/01-home.jpg"
                alt="Cointrack — hlavní přehled na Androidu"
                priority
              />
            </div>
          </div>
        </Container>
      </section>

      {/* ─── SOCIAL PROOF / TRUST ──────────────────────────────────── */}
      <section className="py-12 border-y border-ink-200 bg-white">
        <Container>
          <p className="text-center text-sm text-ink-500 mb-6">
            Napojení na bankovní účty přes regulované PSD2 poskytovatele
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4 text-ink-700 font-medium">
            <span>Fio banka</span>
            <span>Česká spořitelna</span>
            <span>ČSOB</span>
            <span>Komerční banka</span>
            <span>Air Bank</span>
            <span>Raiffeisen</span>
            <span>+ 2500 bank v EU</span>
          </div>
        </Container>
      </section>

      {/* ─── FEATURES GRID ─────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <div className="max-w-2xl mb-16">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900">
              Všechno, co potřebuješ, na jednom místě.
            </h2>
            <p className="mt-4 text-lg text-ink-600">
              Osobní finance, firemní účetnictví, skenování, zálohy. Jeden účet napříč Androidem, webem i iOSem.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={CreditCard}
              title="Automatické napojení bank"
              description="Transakce z Fio, ČSOB, KB, Air Bank a dalších 2500 bank v EU přes PSD2. Bez ručního importu CSV."
            />
            <FeatureCard
              icon={ScanLine}
              title="AI skenování účtenek"
              description="Vyfoť účtenku nebo nahraj PDF faktury. Gemini AI rozpozná prodejce, položky, DPH a zkategorizuje."
            />
            <FeatureCard
              icon={ReceiptText}
              title="Faktury a účtenky pod kontrolou"
              description="Vydané i přijaté faktury, QR platby SPAYD, napojení na iDoklad, export pro účetní v ZIP."
            />
            <FeatureCard
              icon={LineChart}
              title="Přehledné statistiky"
              description="Kde jsi utratil nejvíc? Jak se měsíc po měsíci mění výdaje na bydlení? Grafy a kategorizace."
            />
            <FeatureCard
              icon={Building2}
              title="Oddělené osobní a firemní profily"
              description="Jeden účet, více profilů. OSVČ, s.r.o., rodinný rozpočet — každý se svými účty, kategoriemi, IČO a DIČ."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Bezpečnost jako v bance"
              description="AES-256 šifrovaná DB, biometrie, šifrované zálohy na Google Drive, hostování v České republice."
            />
          </div>
        </Container>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────────────────────── */}
      <section className="py-24 bg-white border-y border-ink-200">
        <Container>
          <div className="max-w-2xl mb-16">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900">
              Z instalace do první synchronizace za 3 minuty.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-10">
            <Step
              num="1"
              title="Stáhni aplikaci"
              text="Android z Google Play, iOS a web brzy. Zaregistruj se emailem."
            />
            <Step
              num="2"
              title="Připoj banku"
              text="Klikni, ověř v IB své banky. Transakce se stáhnou zpět 90 dní."
            />
            <Step
              num="3"
              title="Hotovo"
              text="Další synchronizace probíhá sama. Stačí jen fotit účtenky a dívat se na grafy."
            />
          </div>
        </Container>
      </section>

      {/* ─── CTA ───────────────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <div className="rounded-3xl bg-ink-900 p-12 md:p-20 text-center">
            <Smartphone className="mx-auto mb-6 text-brand-400" size={40} />
            <h2 className="text-4xl font-semibold text-white tracking-tight max-w-2xl mx-auto">
              Začni svým osobním rozpočtem. Nebo s fakturami pro svoji firmu.
            </h2>
            <p className="mt-4 text-lg text-ink-300 max-w-xl mx-auto">
              14 dní zdarma, bez karty. Kdykoliv zrušíš jedním klikem.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild variant="brand" size="lg">
                <Link href="/signup">Vytvořit účet</Link>
              </Button>
              <Button asChild variant="ghost" size="lg" className="text-white hover:bg-ink-800">
                <Link href="/pricing">Podrobný ceník →</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function FeatureCard({
  icon: Icon, title, description,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-ink-200 p-6 hover:border-ink-300 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
        <Icon size={20} />
      </div>
      <h3 className="text-lg font-semibold text-ink-900 mb-2">{title}</h3>
      <p className="text-ink-600 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function Step({ num, title, text }: { num: string; title: string; text: string }) {
  return (
    <div>
      <div className="text-5xl font-semibold text-brand-600 mb-3">{num}</div>
      <h3 className="text-xl font-semibold text-ink-900 mb-2">{title}</h3>
      <p className="text-ink-600">{text}</p>
    </div>
  );
}
