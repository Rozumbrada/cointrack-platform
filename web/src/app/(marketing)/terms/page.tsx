import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("terms");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function TermsPage() {
  const t = await getTranslations("terms");
  const locale = await getLocale();
  const dateStr = new Date().toLocaleDateString(locale);

  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-3xl prose">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-4">
            {t("title")}
          </h1>
          <p className="text-sm text-ink-500 mb-12">{t("last_updated", { date: dateStr })}</p>

          <h2>{t("h_1")}</h2>
          <p>{t("p_1")}</p>

          <h2>{t("h_2")}</h2>
          <p>{t("p_2")}</p>

          <h2>{t("h_3")}</h2>
          <p>
            {t("p_3_pre")}{" "}
            <a href="mailto:security@cointrack.cz">security@cointrack.cz</a>
            {t("p_3_post")}
          </p>

          <h2>{t("h_4")}</h2>
          <p>
            {t("p_4_a_pre")}{" "}
            <a href="/pricing">{t("p_4_a_link")}</a>
            {t("p_4_a_post")}
          </p>
          <p>{t("p_4_b")}</p>

          <h2>{t("h_5")}</h2>
          <p>{t("p_5_a")}</p>
          <p>{t("p_5_b")}</p>

          <h2>{t("h_6")}</h2>
          <p>{t("p_6_a")}</p>
          <p>{t("p_6_b")}</p>

          <h2>{t("h_7")}</h2>
          <p>{t("p_7_a")}</p>
          <p>{t("p_7_b")}</p>

          <h2>{t("h_8")}</h2>
          <ul>
            <li>{t("p_8_1")}</li>
            <li>{t("p_8_2")}</li>
            <li>{t("p_8_3")}</li>
            <li>{t("p_8_4")}</li>
            <li>{t("p_8_5")}</li>
          </ul>

          <h2>{t("h_9")}</h2>
          <p>{t("p_9")}</p>

          <h2>{t("h_10")}</h2>
          <p>
            {t("p_10_pre")}{" "}
            <a href="/privacy">{t("p_10_link")}</a>
            {t("p_10_post")}
          </p>

          <h2>{t("h_11")}</h2>
          <p>{t("p_11_a")}</p>
          <p>{t("p_11_b")}</p>

          <h2>{t("h_contact")}</h2>
          <p>
            {t("p_contact_pre")}{" "}
            <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>
            {t("p_contact_post")}
          </p>
        </div>
      </Container>
    </section>
  );
}
