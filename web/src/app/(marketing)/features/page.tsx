import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  CreditCard, ScanLine, ReceiptText, LineChart, Building2, CloudUpload,
  Scan, FileSpreadsheet, Lock, Smartphone, Languages, Tag,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Funkce",
  description:
    "Skenování účtenek AI, napojení na bankovní účty, faktury, iDoklad, QR platby, statistiky a více.",
};

export default function FeaturesPage() {
  return (
    <>
      <section className="pt-20 pb-16">
        <Container>
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              Co Cointrack umí.
            </h1>
            <p className="mt-6 text-xl text-ink-600">
              Od ruční tabulky v Excelu ke kompletnímu finančnímu systému. Vše, co doopravdy
              používáš — nic navíc.
            </p>
          </div>
        </Container>
      </section>

      <FeatureSection
        icon={CreditCard}
        title="Napojení na bankovní účty"
        screenshot="/screenshots/05-bank-sync.jpg"
        paragraphs={[
          "Přes PSD2 Open Banking se napojíš na Fio, Českou spořitelnu, ČSOB, KB, Air Bank, Raiffeisen a další z 2500+ bank v EU. Bez importu CSV, bez ručního přepisování.",
          "Ověření probíhá v IB tvé banky — tvoje přihlašovací údaje nikdy nevidíme. Data tečou přes regulovaného PSD2 poskytovatele, schváleného ČNB.",
          "Transakce se stáhnou až 90 dní zpětně. Automatický sync v intervalu 1 / 3 / 6 / 12 hodin.",
        ]}
      />

      <FeatureSection
        icon={ScanLine}
        reverse
        title="AI skenování účtenek a faktur"
        screenshot="/screenshots/03-receipts.jpg"
        paragraphs={[
          "Vyfoť účtenku z kavárny nebo nahraj PDF od dodavatele. Google Gemini AI rozpozná prodejce, IČO, datum, celkovou částku, DPH i jednotlivé položky.",
          "Systém sám pozná, jestli jde o účtenku nebo fakturu, a zařadí ji do správné sekce. Účtenku propojí s transakcí v bance — bez tvého zásahu.",
          "Podporuje češtinu i angličtinu. Funguje i na krátké, čtyři roky staré fotky.",
        ]}
      />

      <FeatureSection
        icon={ReceiptText}
        title="Faktury — přijaté i vydané"
        screenshot="/screenshots/04-invoices.jpg"
        paragraphs={[
          "Evidence přijatých i vydaných faktur s přehledem splatnosti. Variabilní symbol, IBAN, suma, DPH — vše v jednom místě.",
          "QR kód pro platbu SPAYD se generuje automaticky. Otevři jakýkoli bankovní app, načti QR, zaplať.",
          "Pro Fio banku: pošli platbu přímo přes Fio API — faktura je zaplacená dříve, než ji zavřeš. Autorizuješ v Fio Smartbanking.",
        ]}
      />

      <FeatureSection
        icon={Building2}
        reverse
        title="Osobní i firemní profily pod jedním účtem"
        screenshot="/screenshots/06-profiles.jpg"
        paragraphs={[
          "Jeden Cointrack účet, více profilů. Rodinný rozpočet, OSVČ, vedlejšák, s.r.o. — každý profil má vlastní účty, kategorie, DPH nastavení, IČO a DIČ.",
          "Firemní profil má přednastavené kategorie podle oboru: pohostinství, IT, zdravotnictví, stavebnictví, vzdělávání, doprava, realitní, zemědělství a další.",
          "Přístup pro účetního: sdílej export faktur a účtenek, aniž by viděl tvé osobní finance.",
        ]}
      />

      <FeatureSection
        icon={FileSpreadsheet}
        title="Integrace s iDoklad a Pohoda"
        paragraphs={[
          "Napojení na iDoklad přes API — vystav fakturu v Cointracku, pošli ji do iDokladu jedním klikem. Načti ClientID a ClientSecret, dál to řeší aplikace.",
          "Export do Pohoda XML pro klasické účetní systémy. Export ZIP pro účetní, který chce vše v jedné složce.",
        ]}
      />

      <FeatureSection
        icon={LineChart}
        reverse
        title="Statistiky, které něco řeknou"
        screenshot="/screenshots/02-transactions.jpg"
        paragraphs={[
          "Kategorie výdajů podle síly utracení. Měsíční a čtvrtletní srovnání. Koláčové a trendové grafy.",
          "Rozpočty na kategorie — upozornění, když ses ocitl pod hranicí. Plánované platby, dlužníci, spořicí cíle.",
        ]}
      />

      <FeatureSection
        icon={CloudUpload}
        title="Zálohy a sync napříč zařízeními"
        paragraphs={[
          "Automatické zálohy do Google Drive — AES-256 šifrované tvým heslem. I kdyby Google uviděl soubor, nic z něj nepřečte.",
          "Sync mezi Androidem, iOSem a webem. Přidej fakturu na notebooku, pošli QR z telefonu.",
          "Export do ZIP se vším potřebným pro migraci mezi zařízeními nebo pro účetního.",
        ]}
      />

      <FeatureSection
        icon={Lock}
        reverse
        title="Bezpečnost jako priorita"
        screenshot="/screenshots/07-settings.jpg"
        paragraphs={[
          "Databáze šifrovaná SQLCipher (AES-256-GCM). Biometrické odemčení (Face ID, otisk). API klíče a tokeny v Android Keystore / iOS Keychain.",
          "Všechny servery v České republice (WEDOS / Hetzner DE). GDPR-compliant, data z EU neopouštějí.",
          "Žádné sdílení dat s třetími stranami. Žádná reklama. Žádné pixely do Facebooku.",
        ]}
      />

      <FeatureSection
        icon={Tag}
        title="Věrnostní karty a čárové kódy"
        paragraphs={[
          "Nasken ČK z peněženky — Tesco Clubcard, Rohlík, Alza Plus. V obchodě otevři kartu v appce, namíří na čtečku.",
          "Dominantní barva loga se extrahuje automaticky — karty vypadají jako v reálu.",
        ]}
      />

      <FeatureSection
        icon={Smartphone}
        reverse
        title="Smart home friendly"
        paragraphs={[
          "Widget na hlavní obrazovku s balancí účtu. Rychlé nahrání účtenky ze ShareSheet. Plánované platby jako připomenutí.",
          "Android Auto podpora pro rychlé zobrazení zůstatku v autě.",
        ]}
      />

      <FeatureSection
        icon={Languages}
        title="Kompletní lokalizace do češtiny i angličtiny"
        paragraphs={[
          "Přepínač jazyka přímo v aplikaci. Nevytváří nové instance při přepnutí.",
          "Anglická varianta pro zahraniční kolegy nebo když cestuješ.",
        ]}
      />
    </>
  );
}

function FeatureSection({
  icon: Icon, title, paragraphs, reverse = false, screenshot,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  paragraphs: string[];
  reverse?: boolean;
  screenshot?: string;
}) {
  return (
    <section className="py-16 border-t border-ink-200">
      <Container>
        <div className={`grid md:grid-cols-2 gap-12 items-center ${reverse ? "md:grid-flow-col-dense" : ""}`}>
          <div className={reverse ? "md:col-start-2" : ""}>
            <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-5">
              <Icon size={22} />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-5">{title}</h2>
            <div className="space-y-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-ink-600 leading-relaxed">{p}</p>
              ))}
            </div>
          </div>
          <div className={`flex justify-center ${reverse ? "md:col-start-1" : ""}`}>
            {screenshot ? (
              <PhoneFrame src={screenshot} alt={title} className="w-full max-w-[260px]" />
            ) : (
              <div className="w-full aspect-video rounded-2xl bg-gradient-to-br from-ink-100 to-ink-200 border border-ink-200" />
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
