import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";
import { Mail, MessageSquare, Shield } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contact");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("contact");
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-3xl">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-6">
            {t("title")}
          </h1>
          <p className="text-xl text-ink-600 mb-12">{t("subtitle")}</p>

          <div className="grid gap-4">
            <ContactCard icon={Mail} title={t("support_title")} email="support@cointrack.cz" description={t("support_desc")} />
            <ContactCard icon={MessageSquare} title={t("sales_title")} email="sales@cointrack.cz" description={t("sales_desc")} />
            <ContactCard icon={Shield} title={t("security_title")} email="security@cointrack.cz" description={t("security_desc")} />
          </div>

          <div className="mt-16 rounded-xl bg-ink-100 p-6">
            <h2 className="font-semibold text-ink-900 mb-2">{t("operator_title")}</h2>
            <div className="text-sm text-ink-600 space-y-1">
              <p>{t("operator_line1")}</p>
              <p>{t("operator_line2")}</p>
              <p>{t("operator_line3")}</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function ContactCard({
  icon: Icon, title, email, description,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  email: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-ink-200 bg-white p-5">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-ink-900">{title}</h3>
        <a
          href={`mailto:${email}`}
          className="text-brand-600 hover:text-brand-700 text-sm font-medium"
        >
          {email}
        </a>
        <p className="text-sm text-ink-600 mt-1">{description}</p>
      </div>
    </div>
  );
}
