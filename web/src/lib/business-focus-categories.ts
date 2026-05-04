/**
 * Předdefinované kategorie pro firemní zaměření.
 * Mirror z mobile (app/src/main/java/cz/wallet/finance/data/model/BusinessFocus.kt).
 *
 * V34: rozšířeno o 12 BÁZOVÝCH kategorií, které se přidávají do KAŽDÉHO
 * zaměření (Personál, Software, Hardware, Marketing, …) — řeší overlap +
 * dává firmě konzistentní základ. Specifické kategorie navíc per zaměření.
 *
 * Při změně v aplikaci ZAROVEŇ aktualizuj i tento soubor — jinak budou
 * mobilní a webová verze nekonzistentní (mobile vytvoří jiné kategorie
 * než web pro stejné zaměření).
 *
 * Ikony jsou Material Icons identifikátory (web i mobile sdílí Google
 * Material Icons font), barvy jsou ARGB int (signed, kompatibilní
 * s Compose Color.toArgb() / Android Color.parseColor()).
 */

export type CategoryType = "EXPENSE" | "INCOME";

export interface FocusCategory {
  name: string;
  type: CategoryType;
  icon: string;
  /** ARGB int — uloží se přímo do Category.color (server akceptuje signed int). */
  color: number;
}

/** ARGB int z hex stringu. Mobile používá `0xFFE53935.toInt()`, my totéž v JS. */
const argb = (hex: string): number => {
  const n = parseInt(hex.replace(/^0x/i, ""), 16) >>> 0;
  // Convert to signed 32-bit (server očekává signed int, sjednoceno s mobile).
  return n | 0;
};

/**
 * Bázové kategorie společné pro VŠECHNA firemní zaměření.
 * categoriesForFocus() je nejdřív přidá, pak doplní specifické per focus.
 */
export const BASE_CATEGORIES: FocusCategory[] = [
  { name: "Personál & mzdy",            type: "EXPENSE", icon: "groups",          color: argb("0xFF1565C0") },
  { name: "Software & licence",         type: "EXPENSE", icon: "apps",            color: argb("0xFF283593") },
  { name: "Hardware & elektronika",     type: "EXPENSE", icon: "devices",         color: argb("0xFF455A64") },
  { name: "Marketing & reklama",        type: "EXPENSE", icon: "campaign",        color: argb("0xFFAD1457") },
  { name: "Kancelářské potřeby",        type: "EXPENSE", icon: "inventory_2",     color: argb("0xFF6D4C41") },
  { name: "Telefon & internet",         type: "EXPENSE", icon: "wifi",            color: argb("0xFF0277BD") },
  { name: "Cestovné & ubytování",       type: "EXPENSE", icon: "flight",          color: argb("0xFF0288D1") },
  { name: "Bankovní poplatky",          type: "EXPENSE", icon: "account_balance", color: argb("0xFF455A64") },
  { name: "Daně & správní poplatky",    type: "EXPENSE", icon: "request_quote",   color: argb("0xFF424242") },
  { name: "Účetní & právní služby",     type: "EXPENSE", icon: "menu_book",       color: argb("0xFF6A1B9A") },
  { name: "Pojistné firemní",           type: "EXPENSE", icon: "security",        color: argb("0xFF0097A7") },
  { name: "Vzdělání & školení",         type: "EXPENSE", icon: "school",          color: argb("0xFF795548") },
];

/**
 * Specifické kategorie per zaměření (BEZ duplikace s BASE_CATEGORIES).
 * categoriesForFocus() je merge-uje s bází.
 */
export const FOCUS_SPECIFIC_CATEGORIES: Record<string, FocusCategory[]> = {
  HEALTHCARE: [
    { name: "Laboratoř & diagnostika",       type: "EXPENSE", icon: "biotech",          color: argb("0xFFE53935") },
    { name: "Zdravotnický materiál",         type: "EXPENSE", icon: "medical_services", color: argb("0xFFE53935") },
    { name: "Léky & přístroje",              type: "EXPENSE", icon: "medication",       color: argb("0xFFE53935") },
    { name: "Pronájem ordinace",             type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Sterilizace & dezinfekce",      type: "EXPENSE", icon: "spa",              color: argb("0xFF00838F") },
    { name: "Externí lékaři & subdodávky",   type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Likvidace zdravotního odpadu",  type: "EXPENSE", icon: "delete",           color: argb("0xFF5D4037") },
    { name: "Příjmy z ordinace",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  RETAIL: [
    { name: "Nákup zboží",                   type: "EXPENSE", icon: "inventory",        color: argb("0xFF5D4037") },
    { name: "Doprava zboží & logistika",     type: "EXPENSE", icon: "local_shipping",   color: argb("0xFF1565C0") },
    { name: "Obaly & packaging",             type: "EXPENSE", icon: "inventory_2",      color: argb("0xFF6D4C41") },
    { name: "Pronájem prodejny",             type: "EXPENSE", icon: "store",            color: argb("0xFF7B1FA2") },
    { name: "E-shop platforma & poplatky",   type: "EXPENSE", icon: "apps",             color: argb("0xFF1A237E") },
    { name: "Vratky & reklamace",            type: "EXPENSE", icon: "undo",             color: argb("0xFFC62828") },
    { name: "Skladové vybavení",             type: "EXPENSE", icon: "warehouse",        color: argb("0xFF5D4037") },
    { name: "Tržby z prodeje",               type: "INCOME",  icon: "point_of_sale",    color: argb("0xFF2E7D32") },
  ],

  GASTRONOMY: [
    { name: "Suroviny & potraviny",          type: "EXPENSE", icon: "restaurant",       color: argb("0xFF4CAF50") },
    { name: "Nápoje & alkohol",              type: "EXPENSE", icon: "local_bar",        color: argb("0xFFE65100") },
    { name: "Energie & voda",                type: "EXPENSE", icon: "bolt",             color: argb("0xFFF57F17") },
    { name: "Vybavení kuchyně",              type: "EXPENSE", icon: "kitchen",          color: argb("0xFF5D4037") },
    { name: "Pronájem provozovny",           type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Obalový materiál",              type: "EXPENSE", icon: "inventory_2",      color: argb("0xFF6D4C41") },
    { name: "Hygiena & čisticí prostředky",  type: "EXPENSE", icon: "spa",              color: argb("0xFF00838F") },
    { name: "Likvidace odpadu",              type: "EXPENSE", icon: "delete",           color: argb("0xFF5D4037") },
    { name: "Doručovací platformy",          type: "EXPENSE", icon: "delivery_dining",  color: argb("0xFFE65100") },
    { name: "Hudební licence",               type: "EXPENSE", icon: "music_note",       color: argb("0xFF6A1B9A") },
    { name: "Tržby",                         type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  IT_TECH: [
    { name: "Cloud & hosting",               type: "EXPENSE", icon: "cloud",            color: argb("0xFF0288D1") },
    { name: "Domény & SSL",                  type: "EXPENSE", icon: "language",         color: argb("0xFF1976D2") },
    { name: "Vývojářské nástroje",           type: "EXPENSE", icon: "code",             color: argb("0xFF283593") },
    { name: "Subdodavatelé & freelanceři",   type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "API & data služby",             type: "EXPENSE", icon: "api",              color: argb("0xFF512DA8") },
    { name: "Kancelář & coworking",          type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Příjmy z projektů",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  CONSTRUCTION: [
    { name: "Stavební materiál",             type: "EXPENSE", icon: "construction",     color: argb("0xFF795548") },
    { name: "Nářadí & stroje",               type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Pronájem techniky",             type: "EXPENSE", icon: "precision_manufacturing", color: argb("0xFF546E7A") },
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "OOPP & pracovní obleky",        type: "EXPENSE", icon: "checkroom",        color: argb("0xFFAD1457") },
    { name: "Lešení & speciální technika",   type: "EXPENSE", icon: "precision_manufacturing", color: argb("0xFF455A64") },
    { name: "Atesty, revize, posudky",       type: "EXPENSE", icon: "verified",         color: argb("0xFF00838F") },
    { name: "Likvidace stavebního odpadu",   type: "EXPENSE", icon: "delete",           color: argb("0xFF5D4037") },
    { name: "Příjmy ze zakázek",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  CONSULTING: [
    { name: "Kancelář & coworking",          type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Odborná literatura",            type: "EXPENSE", icon: "menu_book",        color: argb("0xFF795548") },
    { name: "CRM & klientský software",      type: "EXPENSE", icon: "groups",           color: argb("0xFF283593") },
    { name: "Reprezentace klientů",          type: "EXPENSE", icon: "restaurant",       color: argb("0xFFE65100") },
    { name: "Členství v oborových komorách", type: "EXPENSE", icon: "verified",         color: argb("0xFF00838F") },
    { name: "Subdodavatelé",                 type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Příjmy z poradenství",          type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  AGRICULTURE: [
    { name: "Osivo, hnojiva & postřiky",     type: "EXPENSE", icon: "grass",            color: argb("0xFF388E3C") },
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "Opravy strojů",                 type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Veterinář & léčiva",            type: "EXPENSE", icon: "pets",             color: argb("0xFF00695C") },
    { name: "Pronájem pozemků",              type: "EXPENSE", icon: "landscape",        color: argb("0xFF33691E") },
    { name: "Krmivo & podestýlka",           type: "EXPENSE", icon: "grass",            color: argb("0xFF558B2F") },
    { name: "Závlahové & zemědělské systémy",type: "EXPENSE", icon: "water_drop",       color: argb("0xFF0288D1") },
    { name: "Dotace & granty",               type: "INCOME",  icon: "request_quote",    color: argb("0xFF2E7D32") },
    { name: "Příjmy z prodeje",              type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  EDUCATION: [
    { name: "Studijní materiály & literatura", type: "EXPENSE", icon: "menu_book",      color: argb("0xFF795548") },
    { name: "Pronájem prostor",              type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Honoráře lektorů",              type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "E-learning platformy & LMS",    type: "EXPENSE", icon: "apps",             color: argb("0xFF283593") },
    { name: "Tisk & rozmnožování",           type: "EXPENSE", icon: "print",            color: argb("0xFF455A64") },
    { name: "Certifikace & licence",         type: "EXPENSE", icon: "verified",         color: argb("0xFF00838F") },
    { name: "Školné & kurzovné",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  REAL_ESTATE: [
    { name: "Opravy & údržba",               type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Pojistné nemovitostí",          type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Daně z nemovitostí",            type: "EXPENSE", icon: "account_balance",  color: argb("0xFF1565C0") },
    { name: "Energie & služby",              type: "EXPENSE", icon: "bolt",             color: argb("0xFFF57F17") },
    { name: "Správa & provize",              type: "EXPENSE", icon: "business",         color: argb("0xFF546E7A") },
    { name: "Realitní makléři & provize",    type: "EXPENSE", icon: "handshake",        color: argb("0xFF6A1B9A") },
    { name: "Home staging & focení",         type: "EXPENSE", icon: "photo_camera",     color: argb("0xFFAD1457") },
    { name: "Odhady & znalecké posudky",     type: "EXPENSE", icon: "verified",         color: argb("0xFF00838F") },
    { name: "Nájemné & příjmy",              type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  TRANSPORT: [
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "Opravy & servis vozidel",       type: "EXPENSE", icon: "car_repair",       color: argb("0xFF5D4037") },
    { name: "Dálniční poplatky & mýto",      type: "EXPENSE", icon: "toll",             color: argb("0xFF546E7A") },
    { name: "Pojistné vozidel",              type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Leasing & splátky",             type: "EXPENSE", icon: "account_balance",  color: argb("0xFF1565C0") },
    { name: "Parkoviště & garáže",           type: "EXPENSE", icon: "local_parking",    color: argb("0xFF795548") },
    { name: "STK, EK & servisní knížka",     type: "EXPENSE", icon: "verified",         color: argb("0xFF00838F") },
    { name: "Telematika & sledování flotily",type: "EXPENSE", icon: "gps_fixed",        color: argb("0xFF283593") },
    { name: "Pojištění nákladu & CMR",       type: "EXPENSE", icon: "inventory_2",      color: argb("0xFF6D4C41") },
    { name: "Příjmy z přepravy",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],
};

/**
 * Vrátí kompletní seznam kategorií pro dané zaměření = BASE + specifika.
 * Bez duplikací (porovnává podle name); specifické mají přednost před bází.
 */
export function categoriesForFocus(focus: string): FocusCategory[] {
  const specifics = FOCUS_SPECIFIC_CATEGORIES[focus] ?? [];
  if (specifics.length === 0) return [];
  const specificsByName = new Set(specifics.map((c) => c.name));
  const baseDeduped = BASE_CATEGORIES.filter((c) => !specificsByName.has(c.name));
  return [...baseDeduped, ...specifics];
}

/**
 * Backward-compat alias — zachováno pro callery, kteří dosud používají
 * `BUSINESS_FOCUS_CATEGORIES[focus]` přímo. Nově preferuj
 * `categoriesForFocus(focus)` (vrací base + specifics).
 */
export const BUSINESS_FOCUS_CATEGORIES: Record<string, FocusCategory[]> =
  Object.fromEntries(
    Object.keys(FOCUS_SPECIFIC_CATEGORIES).map((focus) => [
      focus,
      categoriesForFocus(focus),
    ]),
  );
