import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Ochrana osobních údajů",
  description: "Jak Cointrack zpracovává tvá osobní a finanční data.",
};

export default function PrivacyPage() {
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-3xl prose">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-4">
            Ochrana osobních údajů
          </h1>
          <p className="text-sm text-ink-500 mb-12">
            Poslední úprava: {new Date().toLocaleDateString("cs-CZ")}. Tento dokument bude
            finalizován před produkčním spuštěním. Níže je pracovní verze pro beta uživatele.
          </p>

          <h2>Kdo jsme</h2>
          <p>
            Cointrack je služba provozovaná [doplnit obchodní firmu], se sídlem v České
            republice, IČO [doplnit], zapsaná v obchodním rejstříku vedeném [doplnit].
            Kontakt: <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>.
          </p>

          <h2>Co o tobě víme</h2>
          <ul>
            <li>
              <strong>Údaje při registraci</strong>: emailová adresa, heslo (hashované Argon2id),
              volitelně jméno a jazyk.
            </li>
            <li>
              <strong>Finanční data</strong>: transakce z tvých bankovních účtů (po tvém souhlasu),
              faktury, účtenky, rozpočty, cíle. Vše uložené šifrovaně v Postgres v České republice.
            </li>
            <li>
              <strong>Soubory</strong>: fotky účtenek, PDF faktur. V object storage (MinIO / Backblaze B2) v Evropské unii.
            </li>
            <li>
              <strong>Technické údaje</strong>: IP adresa, user-agent, časové značky — pro bezpečnost a prevenci zneužití.
            </li>
          </ul>

          <h2>Právní titul zpracování</h2>
          <p>
            Smlouva — zpracování je nezbytné pro plnění služby, kterou sis objednal(a).
            Pro marketing emaily máš možnost se odhlásit.
          </p>

          <h2>Komu data předáváme</h2>
          <p>
            Zpracovatelé (třetí strany), kteří nám pomáhají službu provozovat:
          </p>
          <ul>
            <li>
              <strong>WEDOS Internet, a.s.</strong> — hosting databáze a souborů, DC Hluboká nad Vltavou, ČR.
            </li>
            <li>
              <strong>Hetzner Online GmbH</strong> — záložní výpočetní kapacita v Německu.
            </li>
            <li>
              <strong>Vercel Inc.</strong> — CDN pro webové rozhraní, EU edge.
            </li>
            <li>
              <strong>Stripe Payments Europe Ltd.</strong> — zpracování plateb předplatného.
            </li>
            <li>
              <strong>Resend</strong> — doručování transakčních emailů.
            </li>
            <li>
              <strong>GoCardless Bank Account Data / Enable Banking</strong> — licencovaní PSD2 AIS poskytovatelé pro napojení bank.
            </li>
            <li>
              <strong>Google LLC</strong> — Gemini API pro OCR účtenek (zpracování v EU, bez uchovávání obsahu).
            </li>
          </ul>
          <p>
            S každým zpracovatelem máme Data Processing Agreement (DPA) v souladu s GDPR.
            Data neprodáváme, nesdílíme pro reklamu, nepředáváme mimo Evropský hospodářský prostor.
          </p>

          <h2>Jak dlouho data uchováváme</h2>
          <ul>
            <li>Finanční data — dokud je u nás tvůj účet. Po smazání účtu: 30 dní zpoždění, pak trvale smazány.</li>
            <li>Faktury a účtenky — v souladu s českou zákonnou povinností 10 let pro účetní doklady.</li>
            <li>Provozní a bezpečnostní logy — 90 dní.</li>
          </ul>

          <h2>Tvá práva</h2>
          <ul>
            <li><strong>Přístup</strong> — export všech dat v ZIP (JSON + soubory) v Nastavení → Účet.</li>
            <li><strong>Oprava</strong> — všechna data můžeš editovat v aplikaci.</li>
            <li><strong>Smazání</strong> — Nastavení → Smazat účet. Operace je nevratná.</li>
            <li><strong>Omezení zpracování</strong> — pozastavením účtu (Nastavení → Deaktivovat).</li>
            <li><strong>Přenositelnost</strong> — export v otevřeném JSON formátu.</li>
            <li><strong>Stížnost u ÚOOÚ</strong> — <a href="https://uoou.gov.cz" target="_blank">uoou.gov.cz</a>.</li>
          </ul>

          <h2>Bezpečnost</h2>
          <ul>
            <li>TLS 1.3 pro veškerou komunikaci</li>
            <li>Hesla hashovaná Argon2id (OWASP standard)</li>
            <li>Databáze šifrovaná na úrovni disku + citlivá pole navíc s pgcrypto</li>
            <li>API tokeny a bankovní credentials v AES-256-GCM</li>
            <li>Pravidelné bezpečnostní audity a penetration testy (před produkčním launch)</li>
            <li>Incident response: kritické incidenty oznamujeme postiženým uživatelům do 72 hodin podle GDPR čl. 33</li>
          </ul>

          <h2>Cookies a trackery</h2>
          <p>
            Web <code>cointrack.cz</code> používá pouze technické cookies nezbytné pro fungování
            (session, preference jazyka). Analytiku děláme přes Plausible, které je cookieless a
            nevyžaduje souhlas dle ePrivacy Directive. Žádné Google Analytics, žádné Facebook Pixel.
          </p>

          <h2>Změny tohoto dokumentu</h2>
          <p>
            Pokud provedeme podstatné změny, oznámíme ti to emailem nejméně 30 dní předem.
            Drobné úpravy (opravy překlepů, formální přepracování) provádíme bez notifikace.
          </p>

          <h2>Kontakt</h2>
          <p>
            Na otázky k ochraně osobních údajů odpovídáme na{" "}
            <a href="mailto:privacy@cointrack.cz">privacy@cointrack.cz</a>.
          </p>
        </div>
      </Container>
    </section>
  );
}
