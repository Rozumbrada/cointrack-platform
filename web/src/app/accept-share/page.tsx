"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { accountShares, AccountSharePreviewDto, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-store";

function AcceptShareInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("accept_share");
  const locale = useLocale();
  const token = params.get("token");

  const [preview, setPreview] = useState<AccountSharePreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(t("fail_no_token"));
      return;
    }
    accountShares.preview(token)
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [token, t]);

  async function onAccept() {
    if (!token) return;
    const at = getAccessToken();
    if (!at) {
      setNeedsLogin(true);
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      await accountShares.accept(at, token);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          // Stale/expired JWT — clear it and ask user to sign in fresh
          if (typeof window !== "undefined") {
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
          }
          setNeedsLogin(true);
        } else if (e.status === 403) {
          setError(t("wrong_email_desc"));
        } else {
          setError(e.message || t("fail_default"));
        }
      } else {
        setError(e instanceof Error ? e.message : t("fail_default"));
      }
    } finally {
      setAccepting(false);
    }
  }

  // Auto-accept: jakmile máme preview a JWT, accept se sám provede.
  // Toto pokryje scénář: user se vrátil přes login → /accept-share s tokenem.
  // User zde nemusí znovu klikat "Přijmout".
  useEffect(() => {
    if (!token) return;
    if (!preview) return;
    if (done || accepting || error) return;
    if (needsLogin) return;
    if (!getAccessToken()) return;
    onAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, preview, done, accepting, error, needsLogin]);

  if (error && !preview) {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-red-700 mb-2">{t("title")}</h1>
        <p className="text-sm text-red-700">{error}</p>
      </Card>
    );
  }

  if (!preview) {
    return <Card><div className="text-center text-ink-500">{t("loading")}</div></Card>;
  }

  if (done) {
    return <DoneRedirect router={router} t={t} accountName={preview.accountName} />;
  }

  if (needsLogin) {
    const next = `/accept-share?token=${encodeURIComponent(token!)}`;
    return (
      <Card>
        <h1 className="text-xl font-semibold text-ink-900 mb-3">{t("title")}</h1>
        <p className="text-sm text-ink-600 mb-6">{t("login_first")}</p>
        <div className="flex gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium grid place-items-center"
          >
            {t("go_login")}
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="flex-1 h-11 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900 grid place-items-center"
          >
            {t("go_signup")}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-ink-900 mb-1">{t("title")}</h1>
      <div className="space-y-2 text-sm text-ink-700 mb-6 mt-4">
        <Row label={t("from")} value={preview.ownerEmail} />
        <Row label={t("account")} value={preview.accountName} bold />
        <Row label={t("profile")} value={preview.profileName} />
        <Row
          label={t("role_label")}
          value={
            preview.role === "EDITOR"
              ? t("role_editor")
              : preview.role === "ACCOUNTANT"
                ? t("role_accountant")
                : t("role_viewer")
          }
        />
      </div>
      {preview.expiresAt && (
        <p className="text-xs text-ink-500 mb-6">
          {t("expires", { date: new Date(preview.expiresAt).toLocaleDateString(locale) })}
        </p>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mb-4">
          {error}
        </div>
      )}
      <button
        onClick={onAccept}
        disabled={accepting}
        className="w-full h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
      >
        {accepting ? t("accepting") : t("accept")}
      </button>
    </Card>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className={bold ? "font-semibold text-ink-900" : "text-ink-900"}>{value}</span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50 grid place-items-center p-6">
      <div className="bg-white rounded-2xl border border-ink-200 shadow-sm p-8 max-w-md w-full">
        {children}
      </div>
    </div>
  );
}

/**
 * Po úspěšném přijetí pozvánky uživatel uvidí krátkou success zprávu (1.5s)
 * a sám se přesměruje na dashboard. Zbyl tu i fallback link, kdyby browser
 * blokoval auto-redirect.
 */
function DoneRedirect({
  router,
  t,
  accountName,
}: {
  router: ReturnType<typeof useRouter>;
  t: ReturnType<typeof useTranslations>;
  accountName: string;
}) {
  useEffect(() => {
    const id = setTimeout(() => {
      router.replace("/app/dashboard");
    }, 1500);
    return () => clearTimeout(id);
  }, [router]);
  return (
    <Card>
      <h1 className="text-2xl font-semibold text-emerald-800 mb-2">{t("ok_title")}</h1>
      <p className="text-ink-700 mb-6">{t("ok_desc", { name: accountName })}</p>
      <p className="text-xs text-ink-500 mb-6">Přesměruji tě za chvíli…</p>
      <Link
        href="/app/dashboard"
        className="inline-block h-11 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium leading-[2.75rem]"
      >
        {t("go_dashboard")}
      </Link>
    </Card>
  );
}

export default function AcceptSharePage() {
  return (
    <Suspense fallback={<Card><div className="text-center text-ink-500">…</div></Card>}>
      <AcceptShareInner />
    </Suspense>
  );
}
