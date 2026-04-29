import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/container";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("meta_title"),
    description: t("meta_description"),
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
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

          <h2>{t("h_who")}</h2>
          <p>
            {t.rich("p_who", {
              email: () => <a href="mailto:support@cointrack.cz">support@cointrack.cz</a>,
            })}
          </p>

          <h2>{t("h_what")}</h2>
          <ul>
            <li><strong>{t("what_register_b")}</strong>{t("what_register")}</li>
            <li><strong>{t("what_finance_b")}</strong>{t("what_finance")}</li>
            <li><strong>{t("what_files_b")}</strong>{t("what_files")}</li>
            <li><strong>{t("what_tech_b")}</strong>{t("what_tech")}</li>
          </ul>

          <h2>{t("h_legal_basis")}</h2>
          <p>{t("p_legal_basis")}</p>

          <h2>{t("h_third")}</h2>
          <p>{t("p_third_intro")}</p>
          <ul>
            <li><strong>{t("third_wedos_b")}</strong>{t("third_wedos")}</li>
            <li><strong>{t("third_hetzner_b")}</strong>{t("third_hetzner")}</li>
            <li><strong>{t("third_vercel_b")}</strong>{t("third_vercel")}</li>
            <li><strong>{t("third_stripe_b")}</strong>{t("third_stripe")}</li>
            <li><strong>{t("third_resend_b")}</strong>{t("third_resend")}</li>
            <li><strong>{t("third_psd2_b")}</strong>{t("third_psd2")}</li>
            <li><strong>{t("third_google_b")}</strong>{t("third_google")}</li>
          </ul>
          <p>{t("p_third_dpa")}</p>

          <h2>{t("h_retention")}</h2>
          <ul>
            <li>{t("retention_finance")}</li>
            <li>{t("retention_invoices")}</li>
            <li>{t("retention_logs")}</li>
          </ul>

          <h2>{t("h_rights")}</h2>
          <ul>
            <li><strong>{t("rights_access_b")}</strong>{t("rights_access")}</li>
            <li><strong>{t("rights_correction_b")}</strong>{t("rights_correction")}</li>
            <li><strong>{t("rights_deletion_b")}</strong>{t("rights_deletion")}</li>
            <li><strong>{t("rights_restrict_b")}</strong>{t("rights_restrict")}</li>
            <li><strong>{t("rights_portability_b")}</strong>{t("rights_portability")}</li>
            <li>
              <strong>{t("rights_complaint_b")}</strong> — <a href="https://uoou.gov.cz" target="_blank">{t("rights_complaint_link")}</a>.
            </li>
          </ul>

          <h2>{t("h_security")}</h2>
          <ul>
            <li>{t("security_tls")}</li>
            <li>{t("security_argon")}</li>
            <li>{t("security_db")}</li>
            <li>{t("security_aes")}</li>
            <li>{t("security_audits")}</li>
            <li>{t("security_incident")}</li>
          </ul>

          <h2>{t("h_cookies")}</h2>
          <p>{t("p_cookies")}</p>

          <h2>{t("h_changes")}</h2>
          <p>{t("p_changes")}</p>

          <h2>{t("h_contact")}</h2>
          <p>
            {t.rich("p_contact", {
              email: () => <a href="mailto:privacy@cointrack.cz">privacy@cointrack.cz</a>,
            })}
          </p>
        </div>
      </Container>
    </section>
  );
}
