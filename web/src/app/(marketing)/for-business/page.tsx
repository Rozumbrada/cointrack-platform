import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("for_business");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function ForBusinessPage() {
  const t = await getTranslations("for_business");
  const useCases = t.raw("use_cases") as { title: string; text: string }[];
  const focuses = t.raw("focuses") as { name: string; categories: string }[];
  const integrations = t.raw("integrations") as { name: string; description: string }[];
  const ctaFeatures = t.raw("cta_features") as string[];

  return (
    <>
      <section className="pt-20 pb-16">
        <Container>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-3 py-1 text-sm text-white mb-6">
              {t("badge")}
            </div>
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              {t("title")}
            </h1>
            <p className="mt-6 text-xl text-ink-600 leading-relaxed">{t("subtitle")}</p>
            <div className="mt-10">
              <Button asChild variant="brand" size="lg">
                <Link href="/signup">{t("cta_trial")}</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-16 bg-white border-y border-ink-200">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-12">
            {t("use_cases_title")}
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {useCases.map((u, i) => (
              <div key={i}>
                <h3 className="text-xl font-semibold text-ink-900 mb-2">{u.title}</h3>
                <p className="text-ink-600 leading-relaxed">{u.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="max-w-2xl mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-4">
              {t("focuses_title")}
            </h2>
            <p className="text-ink-600">{t("focuses_subtitle")}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {focuses.map((focus) => (
              <div key={focus.name} className="rounded-xl border border-ink-200 bg-white p-5">
                <h3 className="font-semibold text-ink-900 mb-1">{focus.name}</h3>
                <p className="text-sm text-ink-600">{focus.categories}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 bg-white border-t border-ink-200">
        <Container>
          <div className="max-w-2xl mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900 mb-4">
              {t("integrations_title")}
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {integrations.map((i) => (
              <div key={i.name} className="rounded-xl border border-ink-200 bg-white p-5">
                <h3 className="font-semibold text-ink-900 mb-2">{i.name}</h3>
                <p className="text-sm text-ink-600 leading-relaxed">{i.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-24">
        <Container>
          <div className="rounded-3xl bg-ink-900 p-12 md:p-16">
            <div className="max-w-2xl">
              <h2 className="text-4xl font-semibold text-white tracking-tight">{t("cta_title")}</h2>
              <p className="mt-4 text-lg text-ink-300">{t("cta_subtitle")}</p>
              <ul className="mt-6 space-y-2">
                {ctaFeatures.map((item) => (
                  <li key={item} className="flex gap-3 text-white">
                    <Check size={18} className="text-brand-400 shrink-0 mt-1" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button asChild variant="brand" size="lg">
                  <Link href="/signup">{t("cta_signup")}</Link>
                </Button>
                <Button asChild variant="ghost" size="lg" className="text-white hover:bg-ink-800">
                  <Link href="/pricing">{t("cta_pricing")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
