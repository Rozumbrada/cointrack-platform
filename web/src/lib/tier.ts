/**
 * Tier display label — raw DB hodnota → uživatelsky čitelný řetězec.
 * Drží se ve sync s mobilem (cz.wallet.finance.data.model.SubscriptionTier).
 *
 * Důležité: DB hodnota "ORGANIZATION" se uživatelsky prezentuje jako "Business Pro".
 * Interní string identifikátor zůstává stejný kvůli backwards compat (API contracts,
 * pricing keys, validace).
 */

export function tierDisplayName(tier: string | null | undefined): string {
  if (!tier) return "Free";
  switch (tier.toUpperCase()) {
    case "FREE":
      return "Free";
    case "PERSONAL":
      return "Personal";
    case "BUSINESS":
      return "Business";
    case "BUSINESS_PRO":
    case "ORGANIZATION": // legacy alias
      return "Business Pro";
    default:
      return tier;
  }
}

/** Pravda pokud user má aspoň Business Pro tier (= odemčené sdílení účtů). */
export function isBusinessProTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const t = tier.toUpperCase();
  return t === "BUSINESS_PRO" || t === "ORGANIZATION";
}
