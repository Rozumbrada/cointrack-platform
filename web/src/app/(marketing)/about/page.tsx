import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  return (
    <section className="pt-20 pb-24">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-5xl font-semibold tracking-tight text-ink-900 mb-8">
            {t("title")}
          </h1>

          <div className="prose">
            <p className="text-xl text-ink-700 leading-relaxed">{t("intro")}</p>

            <h2>{t("for_whom_title")}</h2>
            <p>{t("for_whom_text")}</p>

            <h2>{t("how_title")}</h2>
            <ul>
              <li>
                <strong>{t("how_item1_b")}</strong> {t("how_item1")}
              </li>
              <li>
                <strong>{t("how_item2_b")}</strong> {t("how_item2")}
              </li>
              <li>
                <strong>{t("how_item3_b")}</strong> {t("how_item3")}
              </li>
              <li>
                <strong>{t("how_item4_b")}</strong> {t("how_item4")}
              </li>
            </ul>

            <h2>{t("roadmap_title")}</h2>
            <ul>
              <li>
                <strong>{t("roadmap_q2_b")}</strong>{t("roadmap_q2")}
              </li>
              <li>
                <strong>{t("roadmap_q3_b")}</strong>{t("roadmap_q3")}
              </li>
              <li>
                <strong>{t("roadmap_q4_b")}</strong>{t("roadmap_q4")}
              </li>
            </ul>

            <h2>{t("contact_title")}</h2>
            <p>
              {t("contact_text_before")}{" "}
              <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>
              {t("contact_text_after")}
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
