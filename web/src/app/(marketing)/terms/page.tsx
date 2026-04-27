import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Podmínky služby",
  description: "Smluvní podmínky užívání služby Cointrack.",
};

export default function TermsPage() {
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-3xl prose">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-4">
            Podmínky služby
          </h1>
          <p className="text-sm text-ink-500 mb-12">
            Poslední úprava: {new Date().toLocaleDateString("cs-CZ")}. Pracovní verze pro beta uživatele.
            Plné znění bude revidováno advokátem před produkčním spuštěním.
          </p>

          <h2>1. Předmět smlouvy</h2>
          <p>
            Registrací a používáním služby Cointrack (dále jen „služba") souhlasíš s těmito
            podmínkami. Poskytovatelem je [doplnit obchodní firmu] (dále jen „poskytovatel").
          </p>

          <h2>2. Popis služby</h2>
          <p>
            Cointrack je software-as-a-service pro správu osobních a firemních financí. Umožňuje
            napojení na bankovní účty (přes licencované PSD2 poskytovatele), skenování účtenek,
            správu faktur, vytváření rozpočtů a reportů.
          </p>

          <h2>3. Registrace a účet</h2>
          <p>
            Pro používání služby je nutná registrace. Za bezpečnost přihlašovacích údajů odpovídá
            uživatel. V případě podezření na zneužití účtu kontaktuj{" "}
            <a href="mailto:security@cointrack.cz">security@cointrack.cz</a>.
          </p>

          <h2>4. Cena a platby</h2>
          <p>
            Služba je poskytována v režimu Free (zdarma) a placených tierech (Personal, Business, Organization).
            Ceny jsou uvedeny na stránce <a href="/pricing">Ceník</a>. Fakturace probíhá měsíčně
            nebo ročně dopředu. První 14 dní každého placeného tieru je zdarma.
          </p>
          <p>
            Platby zpracovává Stripe Payments Europe Ltd. Uživatel může kdykoli zrušit předplatné
            — služba zůstane aktivní do konce zaplaceného období.
          </p>

          <h2>5. Dostupnost služby</h2>
          <p>
            Poskytovatel se snaží o maximální dostupnost, ale negarantuje ji absolutně. Pro tier
            Pro platí SLA 99.9% měsíční dostupnost. V případě porušení SLA má uživatel nárok na
            kredit v poměrné výši.
          </p>
          <p>
            Plánované odstávky oznamujeme minimálně 48 hodin předem přes status stránku
            (status.cointrack.cz) a email.
          </p>

          <h2>6. Odpovědnost</h2>
          <p>
            Cointrack je nástroj pro přehled nad financemi, nikoli účetní software ani finanční
            poradenství. Za správnost daňových přiznání, účetních závěrek a finančních rozhodnutí
            odpovídá výhradně uživatel.
          </p>
          <p>
            Poskytovatel neodpovídá za škody vzniklé nedostupností služby, chybou v importu dat,
            chybou OCR ani rozhodnutími uživatele na základě prezentovaných dat. Odpovědnost je
            limitována částkou zaplacenou uživatelem za služby v posledních 12 měsících.
          </p>

          <h2>7. Napojení bank a PSD2</h2>
          <p>
            Cointrack pro čtení transakcí používá licencované AIS (Account Information Services)
            poskytovatele v rámci PSD2 směrnice. Cointrack sám neiniciuje platby z tvého účtu
            (kromě zvláštní funkce pro Fio banku, kde platby autorizuje uživatel v Smartbanking).
          </p>
          <p>
            Uživatel může kdykoli zrušit napojení banky v aplikaci nebo přímo ve své bance.
            Souhlasy s AIS platí 90 dní podle PSD2 SCA regulace, poté je nutné je obnovit.
          </p>

          <h2>8. Zakázané použití</h2>
          <ul>
            <li>Používání služby pro nezákonné účely</li>
            <li>Pokusy o prolomení bezpečnosti služby</li>
            <li>Scraping, reverse engineering, automatizovaný přístup mimo oficiální API</li>
            <li>Vytváření účtů pod falešnou identitou</li>
            <li>Zneužívání free trial registrací</li>
          </ul>

          <h2>9. Ukončení služby</h2>
          <p>
            Uživatel může svůj účet zrušit kdykoli v Nastavení. Poskytovatel si vyhrazuje právo
            ukončit účet uživatele v případě porušení těchto podmínek, neplacení, nebo podezření
            na zneužití, s notifikací 7 dní předem (kromě bezpečnostních incidentů, kde lze
            okamžitě).
          </p>

          <h2>10. Zpracování osobních údajů</h2>
          <p>
            Viz <a href="/privacy">Zásady ochrany osobních údajů</a>.
          </p>

          <h2>11. Závěrečná ustanovení</h2>
          <p>
            Tyto podmínky se řídí právem České republiky. Spory budou řešeny příslušnými soudy
            v místě sídla poskytovatele. Pokud jsi spotřebitel (ne podnikatel), můžeš se obrátit
            na Českou obchodní inspekci (ČOI).
          </p>
          <p>
            Poskytovatel může podmínky měnit s oznámením nejméně 30 dní předem. Pokud s novými
            podmínkami nesouhlasíš, můžeš svůj účet zrušit.
          </p>

          <h2>Kontakt</h2>
          <p>
            Dotazy k těmto podmínkám: <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>.
          </p>
        </div>
      </Container>
    </section>
  );
}
