"use client";

export default function ImportCsvPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Import CSV</h1>
        <p className="text-sm text-ink-600 mt-1">
          Nahrání transakcí ze CSV souboru (typicky Fio bank export).
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm space-y-2">
        <div className="font-medium text-amber-900">Funkce dostupná v mobilní aplikaci</div>
        <p className="text-amber-800">
          Pro CSV import otevři Cointrack v telefonu → menu → <strong>Import CSV</strong>.
          Webová varianta připravujeme — Fio CSV parser, mapování sloupců a hromadné nahrání
          přes sync.
        </p>
        <p className="text-amber-800">
          Alternativa: napoj přímo Fio Bank přes „Bankovní spojení" — synchronizuje
          automaticky každých pár hodin a nemusíš ručně exportovat.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-ink-200 p-6 text-sm text-ink-700 space-y-3">
        <div className="font-medium text-ink-900">Co Cointrack očekává v CSV</div>
        <ul className="list-disc list-inside space-y-1 text-ink-600">
          <li>Standardní Fio CSV export („Pohyby na účtu" → uložit jako CSV s ; oddělovačem)</li>
          <li>Sloupce: ID pohybu, Datum, Objem, Měna, Protiúčet, VS, KS, SS, Zpráva, Typ</li>
          <li>UTF-8 nebo Windows-1250 kódování</li>
        </ul>
      </div>
    </div>
  );
}
