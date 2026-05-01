/**
 * Search query persisted v sessionStorage — přežívá navigaci v rámci jednoho
 * tabu (např. /app/transactions → detail tx → zpět). Ztrácí se až při
 * zavření tabu.
 *
 * Důvod, proč ne URL params: detail page má `<Link href="/app/transactions">`
 * bez query, takže klik "Zpět" by ztratil ?q= ze stavu. SessionStorage je
 * mimo URL, takže navigace se ho nedotkne.
 *
 * Na bookmark/share se dá řešit zvlášť (export sync helper s URL ?q=… +
 * importer při mountu) — pro běžné použití (zachovat search při klikání
 * po app) je sessionStorage 100% spolehlivý.
 */

const PREFIX = "cointrack:search:";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // ignore (private mode / quota)
  }
}

/** Načti search query pro daný "scope" (= URL path / module name). */
export function getPersistedSearch(scope: string): string {
  return safeGet(PREFIX + scope) ?? "";
}

/** Uloží query do sessionStorage. Prázdný string smaže záznam. */
export function setPersistedSearch(scope: string, query: string): void {
  safeSet(PREFIX + scope, query.trim());
}
