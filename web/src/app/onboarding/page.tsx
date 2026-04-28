"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sync, auth, UserDto } from "@/lib/api";
import { withAuth, getAccessToken } from "@/lib/auth-store";
import { setCurrentProfileSyncId } from "@/lib/profile-store";

type ProfileType = "PERSONAL" | "BUSINESS" | "ORGANIZATION";
type AccountType = "CASH" | "BANK";

export default function OnboardingPage() {
  const router = useRouter();
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

  // Pokud už má profil, nemá tu co dělat
  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        const hasProfile = (res.entities["profiles"] ?? []).some((e) => !e.deletedAt);
        const hasAccount = (res.entities["accounts"] ?? []).some((e) => !e.deletedAt);
        if (hasProfile && hasAccount) {
          localStorage.setItem("cointrack:onboarded", "1");
          router.replace("/app/dashboard");
        }
      } catch { /* ignore */ }
    })();
  }, [router]);

  async function createProfile() {
    if (!profileName.trim()) {
      setError("Vyplň název profilu.");
      return;
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
      setError(`Vytvoření profilu selhalo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    if (!createdProfileSyncId) return;
    if (!accountName.trim()) {
      setError("Vyplň název účtu.");
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
      setError(`Vytvoření účtu selhalo: ${e instanceof Error ? e.message : String(e)}`);
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
          <h1 className="text-2xl font-semibold text-ink-900">Vítej v Cointracku 👋</h1>
          <p className="text-sm text-ink-600 mt-1">
            Pomůžeme ti se za minutu rozjet. Krok {step}/3.
          </p>
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

        {/* ─── Krok 1: Profil ─── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-ink-900 mb-1">Vytvoříme tvůj první profil</h2>
              <p className="text-sm text-ink-600">
                Profil sdružuje tvé finance — můžeš jich mít víc (osobní, firemní, …).
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              {(["PERSONAL", "BUSINESS", "ORGANIZATION"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setProfileType(t)}
                  className={`p-3 rounded-xl border text-left ${
                    profileType === t
                      ? "border-brand-600 bg-brand-50 text-brand-900"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <div className="text-xl mb-1">{t === "PERSONAL" ? "👤" : t === "BUSINESS" ? "🏢" : "🏛️"}</div>
                  <div className="font-medium text-xs">
                    {t === "PERSONAL" ? "Osobní" : t === "BUSINESS" ? "Podnikatel" : "Organizace"}
                  </div>
                </button>
              ))}
            </div>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">Název profilu *</div>
              <input
                type="text"
                placeholder={profileType === "BUSINESS" ? "Drdla — OSVČ" : "Já"}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </label>

            {profileType !== "PERSONAL" && (
              <>
                <label className="block">
                  <div className="text-xs text-ink-600 mb-1">Název firmy / organizace</div>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-ink-600 mb-1">IČO</div>
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
              {busy ? "Vytvářím…" : "Pokračovat →"}
            </button>
          </div>
        )}

        {/* ─── Krok 2: Účet ─── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-ink-900 mb-1">Přidej první účet</h2>
              <p className="text-sm text-ink-600">
                Účet je místo, kam patří transakce — bankovní karta, hotovostní pokladna apod.
                Další můžeš přidat kdykoli později.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {(["BANK", "CASH"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setAccountType(t)}
                  className={`p-3 rounded-xl border text-left ${
                    accountType === t
                      ? "border-brand-600 bg-brand-50 text-brand-900"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <div className="text-xl mb-1">{t === "BANK" ? "🏦" : "💵"}</div>
                  <div className="font-medium text-xs">
                    {t === "BANK" ? "Bankovní" : "Hotovost"}
                  </div>
                </button>
              ))}
            </div>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">Název účtu *</div>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </label>

            <label className="block">
              <div className="text-xs text-ink-600 mb-1">Počáteční zůstatek (CZK)</div>
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
                ← Zpět
              </button>
              <button
                onClick={createAccount}
                disabled={busy}
                className="flex-1 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy ? "Vytvářím…" : "Pokračovat →"}
              </button>
            </div>
          </div>
        )}

        {/* ─── Krok 3: Hotovo ─── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="text-5xl mb-2">🎉</div>
              <h2 className="text-xl font-semibold text-ink-900">Hotovo!</h2>
              <p className="text-sm text-ink-600 mt-1">
                Tvůj profil je nastaven a první účet vytvořený. Co dál?
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <Link
                href="/app/import"
                className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30"
              >
                <div className="font-medium text-ink-900">📥 Importovat transakce z CSV</div>
                <div className="text-xs text-ink-600 mt-0.5">
                  Stáhni si pohyby z banky a nahraj je sem.
                </div>
              </Link>

              <Link
                href="/app/banks"
                className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30"
              >
                <div className="font-medium text-ink-900">🏦 Připojit banku (Fio token)</div>
                <div className="text-xs text-ink-600 mt-0.5">
                  Automatická synchronizace pohybů z Fio bank.
                </div>
              </Link>

              <Link
                href="/app/transactions"
                className="block p-3 rounded-lg border border-ink-200 hover:border-brand-300 hover:bg-brand-50/30"
              >
                <div className="font-medium text-ink-900">✏️ Přidat první transakci ručně</div>
                <div className="text-xs text-ink-600 mt-0.5">
                  Zadávej příjmy a výdaje sám.
                </div>
              </Link>

              <Link
                href="/app/upgrade"
                className="block p-3 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100"
              >
                <div className="font-medium text-amber-900">💎 Aktivovat plné funkce</div>
                <div className="text-xs text-amber-800 mt-0.5">
                  Cloud sync, OCR účtenek, organizační účty…
                </div>
              </Link>
            </div>

            <button
              onClick={finish}
              className="w-full h-11 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              Přejít na dashboard
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
