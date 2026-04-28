import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function PricingPage() {
  const t = await getTranslations("pricing");

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
      name: t("free_name"),
      price: t("free_price"),
      description: t("free_desc"),
      cta: t("free_cta"),
      ctaVariant: "outline",
      features: t.raw("free_features") as string[],
      missing: t.raw("free_missing") as string[],
    },
    {
      name: t("personal_name"),
      price: t("personal_price"),
      period: t("per_month"),
      description: t("personal_desc"),
      cta: t("trial_cta"),
      ctaVariant: "primary",
      features: t.raw("personal_features") as string[],
    },
    {
      name: t("business_name"),
      price: t("business_price"),
      period: t("per_month"),
      description: t("business_desc"),
      cta: t("trial_cta"),
      ctaVariant: "brand",
      badge: t("popular"),
      features: t.raw("business_features") as string[],
    },
    {
      name: t("organization_name"),
      price: t("organization_price"),
      period: t("per_month"),
      description: t("organization_desc"),
      cta: t("trial_cta"),
      ctaVariant: "brand",
      features: t.raw("organization_features") as string[],
    },
  ];

  const faqs = t.raw("faq") as { q: string; a: string }[];

  return (
    <>
      <section className="pt-20 pb-12">
        <Container>
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              {t("title")}
            </h1>
            <p className="mt-6 text-xl text-ink-600">{t("subtitle")}</p>
            <p className="mt-3 text-sm text-ink-500">{t("vat_note")}</p>
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
              <p className="font-semibold text-ink-900">{t("yearly_title")}</p>
              <p className="text-sm text-ink-600 mt-1">{t("yearly_desc")}</p>
            </div>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-white border-t border-ink-200">
        <Container>
          <div className="max-w-3xl">
            <h2 className="text-4xl font-semibold tracking-tight text-ink-900 mb-12">
              {t("faq_title")}
            </h2>
            <div className="space-y-8">
              {faqs.map((f, i) => (
                <div key={i}>
                  <h3 className="text-lg font-semibold text-ink-900 mb-2">{f.q}</h3>
                  <p className="text-ink-600 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
