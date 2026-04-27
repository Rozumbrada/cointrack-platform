"use client";

export default function IDokladPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">iDoklad</h1>
        <p className="text-sm text-ink-600 mt-1">
          Synchronizace faktur s online fakturačním systémem iDoklad.cz.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm space-y-2">
        <div className="font-medium text-amber-900">Připojení nastavíš v mobilní aplikaci</div>
        <p className="text-amber-800">
          Otevři Cointrack v telefonu → <strong>Nastavení → Integrace → iDoklad</strong>,
          zadej Client ID a Client Secret z iDoklad portálu. Po přihlášení se faktury
          (vystavené i přijaté) automaticky stáhnou a budou viditelné i tady.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-ink-200 p-6 text-sm text-ink-700 space-y-3">
        <div className="font-medium text-ink-900">Jak získat přístup k iDoklad API</div>
        <ol className="list-decimal list-inside space-y-1 text-ink-600">
          <li>Přihlas se na <a href="https://app.idoklad.cz" target="_blank" rel="noopener" className="text-brand-600 hover:text-brand-700">app.idoklad.cz</a></li>
          <li>Nastavení → API klíče → Vygenerovat nový (typ „Client Credentials")</li>
          <li>Zkopíruj Client ID a Client Secret do mobilní aplikace</li>
        </ol>
      </div>
    </div>
  );
}
