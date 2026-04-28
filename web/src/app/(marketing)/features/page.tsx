import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";
import { PhoneFrame } from "@/components/marketing/PhoneFrame";
import {
  CreditCard, ScanLine, ReceiptText, LineChart, Building2, CloudUpload,
  FileSpreadsheet, Lock, Smartphone, Languages, Tag,
} from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("features_page");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

const ICONS = [CreditCard, ScanLine, ReceiptText, Building2, FileSpreadsheet, LineChart, CloudUpload, Lock, Tag, Smartphone, Languages];
const SCREENSHOTS: (string | undefined)[] = [
  "/screenshots/05-bank-sync.jpg",
  "/screenshots/03-receipts.jpg",
  "/screenshots/04-invoices.jpg",
  "/screenshots/06-profiles.jpg",
  undefined,
  "/screenshots/02-transactions.jpg",
  undefined,
  "/screenshots/07-settings.jpg",
  undefined,
  undefined,
  undefined,
];

export default async function FeaturesPage() {
  const t = await getTranslations("features_page");
  const sections = t.raw("sections") as { title: string; paragraphs: string[] }[];

  return (
    <>
      <section className="pt-20 pb-16">
        <Container>
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-tight text-ink-900">
              {t("title")}
            </h1>
            <p className="mt-6 text-xl text-ink-600">{t("subtitle")}</p>
          </div>
        </Container>
      </section>

      {sections.map((s, i) => (
        <FeatureSection
          key={i}
          icon={ICONS[i] ?? CreditCard}
          title={s.title}
          paragraphs={s.paragraphs}
          screenshot={SCREENSHOTS[i]}
          reverse={i % 2 === 1}
        />
      ))}
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
