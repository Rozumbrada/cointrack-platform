import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  CreditCard, ReceiptText, ScanLine, LineChart, ShieldCheck,
  Smartphone, Building2, Sparkles,
} from "lucide-react";

export default async function HomePage() {
  const t = await getTranslations("marketing");
  return (
    <>
      {/* ─── HERO ───────────────────────────────────────────────────── */}
      <section className="pt-16 pb-20 md:pt-20 md:pb-24">
        <Container>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-700 mb-6">
                <Sparkles size={14} />
                <span>{t("hero.badge")}</span>
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-ink-900 leading-[1.05]">
                {t("hero.title")}
              </h1>
              <p className="mt-6 text-lg md:text-xl text-ink-600 leading-relaxed">
                {t("hero.subtitle")}
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Button asChild variant="brand" size="lg">
                  <Link href="/signup">{t("hero.cta_signup")}</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/features">{t("hero.cta_features")}</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-ink-500">{t("hero.cta_note")}</p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <PhoneFrame
                src="/screenshots/01-home.jpg"
                alt={t("hero.phone_alt")}
                priority
              />
            </div>
          </div>
        </Container>
      </section>

      {/* ─── SOCIAL PROOF / TRUST ──────────────────────────────────── */}
      <section className="py-12 border-y border-ink-200 bg-white">
        <Container>
          <p className="text-center text-sm text-ink-500 mb-6">{t("trust.title")}</p>
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4 text-ink-700 font-medium">
            <span>Fio banka</span>
            <span>Česká spořitelna</span>
            <span>ČSOB</span>
            <span>Komerční banka</span>
            <span>Air Bank</span>
            <span>Raiffeisen</span>
            <span>{t("trust.more")}</span>
          </div>
        </Container>
      </section>

      {/* ─── FEATURES GRID ─────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <div className="max-w-2xl mb-16">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900">
              {t("features.title")}
            </h2>
            <p className="mt-4 text-lg text-ink-600">{t("features.subtitle")}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard icon={CreditCard} title={t("features.banks_title")} description={t("features.banks_desc")} />
            <FeatureCard icon={ScanLine} title={t("features.ai_title")} description={t("features.ai_desc")} />
            <FeatureCard icon={ReceiptText} title={t("features.invoices_title")} description={t("features.invoices_desc")} />
            <FeatureCard icon={LineChart} title={t("features.stats_title")} description={t("features.stats_desc")} />
            <FeatureCard icon={Building2} title={t("features.profiles_title")} description={t("features.profiles_desc")} />
            <FeatureCard icon={ShieldCheck} title={t("features.security_title")} description={t("features.security_desc")} />
          </div>
        </Container>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────────────────────── */}
      <section className="py-24 bg-white border-y border-ink-200">
        <Container>
          <div className="max-w-2xl mb-16">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900">
              {t("how_it_works.title")}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-10">
            <Step num="1" title={t("how_it_works.step1_title")} text={t("how_it_works.step1_text")} />
            <Step num="2" title={t("how_it_works.step2_title")} text={t("how_it_works.step2_text")} />
            <Step num="3" title={t("how_it_works.step3_title")} text={t("how_it_works.step3_text")} />
          </div>
        </Container>
      </section>

      {/* ─── CTA ───────────────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <div className="rounded-3xl bg-ink-900 p-12 md:p-20 text-center">
            <Smartphone className="mx-auto mb-6 text-brand-400" size={40} />
            <h2 className="text-4xl font-semibold text-white tracking-tight max-w-2xl mx-auto">
              {t("cta.title")}
            </h2>
            <p className="mt-4 text-lg text-ink-300 max-w-xl mx-auto">{t("cta.subtitle")}</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild variant="brand" size="lg">
                <Link href="/signup">{t("cta.signup")}</Link>
              </Button>
              <Button asChild variant="ghost" size="lg" className="text-white hover:bg-ink-800">
                <Link href="/pricing">{t("cta.pricing")}</Link>
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
