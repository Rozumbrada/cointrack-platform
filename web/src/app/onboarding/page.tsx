"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { sync, auth, UserDto } from "@/lib/api";
import { withAuth, getAccessToken } from "@/lib/auth-store";
import { setCurrentProfileSyncId } from "@/lib/profile-store";

type ProfileType = "PERSONAL" | "BUSINESS" | "ORGANIZATION";
type AccountType = "CASH" | "BANK";

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations("onboarding");
  const [user, setUser] = useState<UserDto | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [profileName, setProfileName] = useState("");
  const [profileType, setProfileType] = useState<ProfileType>("PERSONAL");
  const [companyName, setCompanyName] = useState("");
  const [companyIco, setCompanyIco] = useState("");
  const [createdProfileSyncId, setCreatedProfileSyncId] = useState<string | null>(null);

  // Step 2
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("BANK");
  const [accountInitialBalance, setAccountInitialBalance] = useState("0");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    auth.me(token).then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  // Pokud už má profil (vlastní NEBO sdílený), nemá tu co dělat. Recipient po
  // acceptu pozvánky má `shared` profil v sync — onboarding by ho nutil vytvářet
  // svůj vlastní, což byl bug (uživatelé si během onboardingu vytvořili duplicity).
  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        const hasProfile = (res.entities["profiles"] ?? []).some((e) => !e.deletedAt);
        if (hasProfile) {
          // Profil existuje (vlastní nebo sdílený) — preskoč onboarding.
          localStorage.setItem("cointrack:onboarded", "1");
          router.replace("/app/dashboard");
        }
      } catch { /* ignore */ }
    })();
  }, [router]);

  async function createProfile() {
    if (!profileName.trim()) {
      setError(t("fill_profile_name"));
      return;
    }

    // Tier guard — mirror serveru: FREE/PERSONAL může jen PERSONAL profil,
    // BUSINESS tier povolí BUSINESS, BUSINESS_PRO+ povolí ORGANIZATION/GROUP.
    const tier = (user?.tier ?? "FREE").toUpperCase();
    const wantsBusiness = profileType === "BUSINESS";
    const wantsOrg = profileType === "ORGANIZATION";
    if (wantsBusiness && tier !== "BUSINESS" && tier !== "BUSINESS_PRO" && tier !== "ORGANIZATION") {
      setError("Firemní profil vyžaduje tarif Business nebo vyšší. Můžeš si vytvořit osobní profil a kdykoliv upgradovat.");
      return;
    }
    if (wantsOrg && tier !== "BUSINESS_PRO" && tier !== "ORGANIZATION") {
      setError("Organizační profil vyžaduje tarif Business Pro. Můžeš si vytvořit osobní profil a kdykoliv upgradovat.");
      return;
    }

    // Dup-ICO warning — pokud už existuje profil se stejným IČO, požádej o potvrzení.
    if (companyIco.trim()) {
      try {
        const pull = await withAuth((tk) => sync.pull(tk));
        const existingWithIco = (pull.entities["profiles"] ?? []).filter((en) => {
          if (en.deletedAt) return false;
          const d = en.data as Record<string, unknown>;
          if (d.deletedAt != null && d.deletedAt !== 0) return false;
          return String(d.ico ?? "") === companyIco.trim();
        });
        if (existingWithIco.length > 0) {
          const namesList = existingWithIco
            .map((en) => `${(en.data as Record<string, unknown>).name ?? ""}`)
            .join(", ");
          const ok = confirm(
            `Už máš profil(y) s IČO ${companyIco.trim()}: ${namesList}.\n\n` +
              `Opravdu chceš vytvořit další profil se stejným IČO?`,
          );
          if (!ok) return;
        }
      } catch { /* defense-in-depth, neblokuj submit */ }
    }

    setBusy(true); setError(null);
    try {
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            profiles: [
              {
                syncId,
                updatedAt: now,
                deletedAt: null,
                clientVersion: 1,
                data: {
                  ownerUserId: user?.id,
                  name: profileName.trim(),
                  type: profileType,
                  companyName: companyName.trim() || null,
                  ico: companyIco.trim() || null,
                  color: profileColor(profileType),
                },
              },
            ],
          },
        }),
      );
      setCreatedProfileSyncId(syncId);
      setCurrentProfileSyncId(syncId);
      // Auto-suggest account name
      setAccountName(profileType === "BUSINESS" ? "Firemní účet" : "Hlavní účet");
      setStep(2);
    } catch (e) {
      setError(t("create_profile_failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    if (!createdProfileSyncId) return;
    if (!accountName.trim()) {
      setError(t("fill_account_name"));
      return;
    }
    setBusy(true); setError(null);
    try {
      const syncId = crypto.randomUUID();
      const now = new Date().toISOString();
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            accounts: [
              {
                syncId,
                updatedAt: now,
                deletedAt: null,
                clientVersion: 1,
                data: {
                  profileId: createdProfileSyncId,
                  name: accountName.trim(),
                  type: accountType,
                  currency: "CZK",
                  initialBalance: accountInitialBalance || "0",
                  excludedFromTotal: false,
                },
              },
            ],
          },
        }),
      );
      setStep(3);
    } catch (e) {
      setError(t("create_account_failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    localStorage.setItem("cointrack:onboarded", "1");
    router.replace("/app/dashboard");
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg max-w-xl w-full p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("welcome")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("step_progress", { step })}</p>
          <div className="flex gap-2 mt-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-brand-600" : "bg-ink-200"}`}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* ─── Step 1: Profile ─── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-ink-900 mb-1">{t("step1_title")}</h2>
              <p className="text-sm text-ink-600">{t("step1_desc")}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              {(["PERSONAL", "BUSINESS", "ORGANIZATION"] as const).map((pt) => {
                const tier = (user?.tier ?? "FREE").toUpperCase();
                const locked =
                  (pt === "BUSINESS" && tier !== "BUSINESS" && tier !== "BUSINESS_PRO" && tier !== "ORGANIZATION") ||
                  (pt === "ORGANIZATION" && tier !== "BUSINESS_PRO" && tier !== "ORGANIZATION");
                return (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => !locked && setProfileType(pt)}
                    disabled={locked}
                    className={`p-3 rounded-xl border text-left relative ${
                      locked
                        ? "border-ink-200 bg-ink-50 opacity-60 cursor-not-allowed"
                        : profileType === pt
                          ? "border-brand-600 bg-brand-50 text-brand-900"
                          : "border-ink-200 hover:border-ink-300"
                    }`}
                  >
                    <div className="text-xl mb-1">{pt === "PERSONAL" ? "👤" : pt === "BUSINESS" ? "🏢" : "🏛️"}</div>
                    <div className="font-medium text-xs">
                      {pt === "PERSONAL" ? t("type_personal") : pt === "BUSINESS" ? t("type_business") : t("type_organization")}
                    </div>
                    {locked && (
                      <div className="absolute top-1 right-1 text-[9px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
                        {pt === "BUSINESS" ? "Business" : "Pro"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">{t("profile_name")}</div>
              <input
                type="text"
                placeholder={profileType === "BUSINESS" ? t("profile_name_placeholder_business") : t("profile_name_placeholder_personal")}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </label>

            {profileType !== "PERSONAL" && (
              <>
                <label className="block">
                  <div className="text-xs text-ink-600 mb-1">{t("company_name")}</div>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-ink-600 mb-1">{t("company_ico")}</div>
                  <input
                    type="text"
                    value={companyIco}
                    onChange={(e) => setCompanyIco(e.target.value)}
                    className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
                  />
                </label>
              </>
            )}

            <button
              onClick={createProfile}
              disabled={busy}
              className="w-full h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              {busy ? t("creating") : t("continue")}
            </button>
          </div>
        )}

        {/* ─── Step 2: Account ─── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-ink-900 mb-1">{t("step2_title")}</h2>
              <p className="text-sm text-ink-600">{t("step2_desc")}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {(["BANK", "CASH"] as const).map((at) => (
                <button
                  key={at}
                  onClick={() => setAccountType(at)}
                  className={`p-3 rounded-xl border text-left ${
                    accountType === at
                      ? "border-brand-600 bg-brand-50 text-brand-900"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <div className="text-xl mb-1">{at === "BANK" ? "🏦" : "💵"}</div>
                  <div className="font-medium text-xs">
                    {at === "BANK" ? t("type_bank") : t("type_cash")}
                  </div>
                </button>
              ))}
            </div>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">{t("account_name")}</div>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </label>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">{t("initial_balance")}</div>
              <input
                type="number"
                step="0.01"
                value={accountInitialBalance}
                onChange={(e) => setAccountInitialBalance(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                disabled={busy}
                className="h-11 px-4 rounded-lg border border-ink-300 hover:bg-ink-50 text-sm font-medium text-ink-900"
              >
                {t("back")}
              </button>
              <button
                onClick={createAccount}
                disabled={busy}
                className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy ? t("creating") : t("continue")}
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Done ─── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="text-5xl mb-2">🎉</div>
              <h2 className="text-xl font-semibold text-ink-900">{t("step3_title")}</h2>
              <p className="text-sm text-ink-600 mt-1">{t("step3_desc")}</p>
            </div>

            <div className="space-y-2 text-sm">
              <Link href="/app/import" className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30">
                <div className="font-medium text-ink-900">{t("next_import")}</div>
                <div className="text-xs text-ink-600 mt-0.5">{t("next_import_desc")}</div>
              </Link>

              <Link href="/app/banks" className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30">
                <div className="font-medium text-ink-900">{t("next_banks")}</div>
                <div className="text-xs text-ink-600 mt-0.5">{t("next_banks_desc")}</div>
              </Link>

              <Link href="/app/transactions" className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30">
                <div className="font-medium text-ink-900">{t("next_tx")}</div>
                <div className="text-xs text-ink-600 mt-0.5">{t("next_tx_desc")}</div>
              </Link>

              <Link href="/app/upgrade" className="block p-3 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100">
                <div className="font-medium text-amber-900">{t("next_upgrade")}</div>
                <div className="text-xs text-amber-800 mt-0.5">{t("next_upgrade_desc")}</div>
              </Link>
            </div>

            <button
              onClick={finish}
              className="w-full h-11 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              {t("go_dashboard")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function profileColor(type: ProfileType): number {
  switch (type) {
    case "PERSONAL": return -16745473;     // modrá
    case "BUSINESS": return -13726889;     // tyrkysová
    case "ORGANIZATION": return -8579839;  // fialová
  }
}
