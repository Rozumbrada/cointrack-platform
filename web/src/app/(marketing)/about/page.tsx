import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "O nás",
  description: "Kdo stojí za Cointrackem a proč děláme finanční app pro Česko.",
};

export default function AboutPage() {
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-8">
            Proč Cointrack existuje.
          </h1>

          <div className="prose">
            <p className="text-xl text-ink-700 leading-relaxed">
              Většina finančních appek je buď zahraniční a nezná Fio banku, nebo česká
              a vypadá jako z roku 2015. Chtěli jsme něco, co umí oboje a vypadá dobře
              na telefonu, tabletu i notebooku.
            </p>

            <h2>Pro koho to děláme</h2>
            <p>
              Pro lidi, kteří používají víc českých i zahraničních účtů, občas vystaví
              fakturu nebo naopak dostanou, a občas chtějí vědět, kam jim tečou peníze.
              Pro OSVČ, který si musí sám hlídat DPH a termíny splatnosti. Pro rodiny,
              co chtějí pochopit, proč je účet za elektřinu větší než loni.
            </p>

            <h2>Jak to děláme</h2>
            <ul>
              <li>
                <strong>Nejsme banka</strong> — jsme čtenář tvých dat, která používáš u své
                banky. Pro napojení používáme licencované PSD2 poskytovatele.
              </li>
              <li>
                <strong>Všechno v Evropské unii</strong> — servery v České republice a Německu.
                Data EU neopouštějí, GDPR je základ.
              </li>
              <li>
                <strong>Open source komponenty</strong> — databáze (Postgres), šifrování
                (SQLCipher), UI framework (Compose). Žádné black boxy.
              </li>
              <li>
                <strong>Bez reklamy a bez sdílení dat</strong> — tvá data jsou tvá. Ne produkt.
              </li>
            </ul>

            <h2>Roadmap</h2>
            <ul>
              <li>
                <strong>Q2 2026</strong>: Android ✓, web beta, napojení českých bank přes PSD2
              </li>
              <li>
                <strong>Q3 2026</strong>: iOS beta, multi-tenant pro účetní
              </li>
              <li>
                <strong>Q4 2026</strong>: Public API, export do více účetních systémů
              </li>
            </ul>

            <h2>Kontakt</h2>
            <p>
              Máš otázku, feedback nebo bug? Napiš na{" "}
              <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>.
              Odpovídáme do 1 pracovního dne.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
