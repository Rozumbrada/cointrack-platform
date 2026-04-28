"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

function buildDeepLink(token: string, isAndroid: boolean): string {
  const encodedToken = encodeURIComponent(token);
  if (isAndroid) {
    const fallback = encodeURIComponent(
      "https://play.google.com/store/apps/details?id=cz.wallet.finance",
    );
    return (
      `intent://accept-invite?token=${encodedToken}` +
      `#Intent;scheme=cointrack;package=cz.wallet.finance;` +
      `S.browser_fallback_url=${fallback};end`
    );
  }
  return `cointrack://accept-invite?token=${encodedToken}`;
}

function InviteContent() {
  const params = useSearchParams();
  const t = useTranslations("auth.invite");
  const token = params.get("token") ?? "";
  const [attempted, setAttempted] = useState(false);
  const [deepLink, setDeepLink] = useState("");

  useEffect(() => {
    if (!token) return;
    const isAndroid = /android/i.test(
      typeof navigator !== "undefined" ? navigator.userAgent : "",
    );
    const link = buildDeepLink(token, isAndroid);
    setDeepLink(link);
    window.location.href = link;
    const timer = setTimeout(() => setAttempted(true), 1500);
    return () => clearTimeout(timer);
  }, [token]);

  if (!token) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-ink-900 mb-2">{t("invalid_title")}</h1>
        <p className="text-ink-600 mb-6">{t("invalid_desc")}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">{t("go_home")}</Link>
        </Button>
      </div>
    );
  }

  const playStoreUrl = "https://play.google.com/store/apps/details?id=cz.wallet.finance";

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink-900 mb-2">{t("title")}</h1>
      <p className="text-ink-600 mb-6">{t("intro")}</p>

      <div className="space-y-3">
        <Button asChild variant="brand" className="w-full">
          <a href={deepLink}>{t("open_app")}</a>
        </Button>

        {attempted && (
          <div className="rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 text-sm text-ink-700">
            <p className="font-medium mb-1">{t("no_app_title")}</p>
            <p className="mb-3">{t("no_app_desc")}</p>
            <Button asChild variant="outline" className="w-full">
              <a href={playStoreUrl} target="_blank" rel="noopener noreferrer">
                {t("play_download")}
              </a>
            </Button>
          </div>
        )}

        <details className="text-sm text-ink-500">
          <summary className="cursor-pointer">{t("cant_open")}</summary>
          <p className="mt-2">
            {t("manual_help_pre")} <strong>{t("manual_help_cloud")}</strong>{t("manual_help_arrow")}<strong>{t("manual_help_org")}</strong> {t("manual_help_post")}
          </p>
          <code className="mt-2 block bg-ink-50 border border-ink-200 rounded p-2 text-xs break-all">
            {token}
          </code>
        </details>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="text-center text-ink-500">…</div>}>
      <InviteContent />
    </Suspense>
  );
}
