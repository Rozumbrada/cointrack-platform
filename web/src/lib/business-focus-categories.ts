/**
 * Předdefinované kategorie pro firemní zaměření.
 * Mirror z mobile (app/src/main/java/cz/wallet/finance/data/model/BusinessFocus.kt).
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

export const BUSINESS_FOCUS_CATEGORIES: Record<string, FocusCategory[]> = {
  HEALTHCARE: [
    { name: "Laboratoř & diagnostika",       type: "EXPENSE", icon: "biotech",          color: argb("0xFFE53935") },
    { name: "Zdravotnický materiál",         type: "EXPENSE", icon: "medical_services", color: argb("0xFFE53935") },
    { name: "Léky & přístroje",              type: "EXPENSE", icon: "medication",       color: argb("0xFFE53935") },
    { name: "Pronájem ordinace",             type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Personál & mzdy",               type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Pojistné",                      type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Certifikace & vzdělání",        type: "EXPENSE", icon: "school",           color: argb("0xFF795548") },
    { name: "Příjmy z ordinace",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  RETAIL: [
    { name: "Nákup zboží",                   type: "EXPENSE", icon: "inventory",        color: argb("0xFF5D4037") },
    { name: "Doprava & logistika",           type: "EXPENSE", icon: "local_shipping",   color: argb("0xFF1565C0") },
    { name: "Obaly & packaging",             type: "EXPENSE", icon: "inventory_2",      color: argb("0xFF6D4C41") },
    { name: "Marketing & reklama",           type: "EXPENSE", icon: "campaign",         color: argb("0xFFAD1457") },
    { name: "Pronájem prodejny",             type: "EXPENSE", icon: "store",            color: argb("0xFF7B1FA2") },
    { name: "Personál & mzdy",               type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Tržby z prodeje",               type: "INCOME",  icon: "point_of_sale",    color: argb("0xFF2E7D32") },
  ],

  GASTRONOMY: [
    { name: "Suroviny & potraviny",          type: "EXPENSE", icon: "restaurant",       color: argb("0xFF4CAF50") },
    { name: "Nápoje & alkohol",              type: "EXPENSE", icon: "local_bar",        color: argb("0xFFE65100") },
    { name: "Personál & mzdy",               type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Energie & voda",                type: "EXPENSE", icon: "bolt",             color: argb("0xFFF57F17") },
    { name: "Vybavení kuchyně",              type: "EXPENSE", icon: "kitchen",          color: argb("0xFF5D4037") },
    { name: "Pronájem provozovny",           type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Obalový materiál",              type: "EXPENSE", icon: "inventory_2",      color: argb("0xFF6D4C41") },
    { name: "Tržby",                         type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  IT_TECH: [
    { name: "Licence & software",            type: "EXPENSE", icon: "apps",             color: argb("0xFF283593") },
    { name: "Cloud & hosting",               type: "EXPENSE", icon: "cloud",            color: argb("0xFF0288D1") },
    { name: "Hardware",                      type: "EXPENSE", icon: "devices",          color: argb("0xFF455A64") },
    { name: "Subdodavatelé & freelanceři",   type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Marketing & SEO",               type: "EXPENSE", icon: "campaign",         color: argb("0xFFAD1457") },
    { name: "Konference & vzdělání",         type: "EXPENSE", icon: "school",           color: argb("0xFF795548") },
    { name: "Kancelář & pronájem",           type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Příjmy z projektů",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  CONSTRUCTION: [
    { name: "Stavební materiál",             type: "EXPENSE", icon: "construction",     color: argb("0xFF795548") },
    { name: "Nářadí & stroje",               type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Pronájem techniky",             type: "EXPENSE", icon: "precision_manufacturing", color: argb("0xFF546E7A") },
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "Pojistné",                      type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Personál & mzdy",               type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "OOPP & pracovní obleky",        type: "EXPENSE", icon: "checkroom",        color: argb("0xFFAD1457") },
    { name: "Příjmy ze zakázek",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  CONSULTING: [
    { name: "Kancelář & pronájem",           type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Odborná literatura",            type: "EXPENSE", icon: "menu_book",        color: argb("0xFF795548") },
    { name: "Pojistné – profesní",           type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Marketing & web",               type: "EXPENSE", icon: "campaign",         color: argb("0xFFAD1457") },
    { name: "Cestovné & diety",              type: "EXPENSE", icon: "flight",           color: argb("0xFF0288D1") },
    { name: "Konference & semináře",         type: "EXPENSE", icon: "school",           color: argb("0xFF795548") },
    { name: "Subdodavatelé",                 type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Příjmy z poradenství",          type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  AGRICULTURE: [
    { name: "Osivo, hnojiva & postřiky",     type: "EXPENSE", icon: "grass",            color: argb("0xFF388E3C") },
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "Opravy strojů",                 type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Veterinář & léčiva",            type: "EXPENSE", icon: "pets",             color: argb("0xFF00695C") },
    { name: "Pojistné zemědělské",           type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Pronájem pozemků",              type: "EXPENSE", icon: "landscape",        color: argb("0xFF33691E") },
    { name: "Příjmy z prodeje",              type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  EDUCATION: [
    { name: "Studijní materiály & literatura", type: "EXPENSE", icon: "menu_book",      color: argb("0xFF795548") },
    { name: "Pronájem prostor",              type: "EXPENSE", icon: "apartment",        color: argb("0xFF7B1FA2") },
    { name: "Technika & IT",                 type: "EXPENSE", icon: "devices",          color: argb("0xFF455A64") },
    { name: "Marketing & propagace",         type: "EXPENSE", icon: "campaign",         color: argb("0xFFAD1457") },
    { name: "Honoráře lektorů",              type: "EXPENSE", icon: "groups",           color: argb("0xFF1565C0") },
    { name: "Certifikace & licence",         type: "EXPENSE", icon: "school",           color: argb("0xFF795548") },
    { name: "Školné & kurzovné",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  REAL_ESTATE: [
    { name: "Opravy & údržba",               type: "EXPENSE", icon: "build",            color: argb("0xFF5D4037") },
    { name: "Pojistné nemovitostí",          type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Daně z nemovitostí",            type: "EXPENSE", icon: "account_balance",  color: argb("0xFF1565C0") },
    { name: "Energie & služby",              type: "EXPENSE", icon: "bolt",             color: argb("0xFFF57F17") },
    { name: "Správa & provize",              type: "EXPENSE", icon: "business",         color: argb("0xFF546E7A") },
    { name: "Marketing & inzerce",           type: "EXPENSE", icon: "campaign",         color: argb("0xFFAD1457") },
    { name: "Nájemné & příjmy",              type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],

  TRANSPORT: [
    { name: "Pohonné hmoty",                 type: "EXPENSE", icon: "local_gas_station", color: argb("0xFFE65100") },
    { name: "Opravy & servis vozidel",       type: "EXPENSE", icon: "car_repair",       color: argb("0xFF5D4037") },
    { name: "Dálniční poplatky & mýto",      type: "EXPENSE", icon: "toll",             color: argb("0xFF546E7A") },
    { name: "Pojistné vozidel",              type: "EXPENSE", icon: "security",         color: argb("0xFF0097A7") },
    { name: "Leasing & splátky",             type: "EXPENSE", icon: "account_balance",  color: argb("0xFF1565C0") },
    { name: "Parkoviště & garáže",           type: "EXPENSE", icon: "local_parking",    color: argb("0xFF795548") },
    { name: "Příjmy z přepravy",             type: "INCOME",  icon: "payments",         color: argb("0xFF2E7D32") },
  ],
};

/** Vrátí kategorie pro dané zaměření. Vrátí `[]` pokud focus neexistuje. */
export function categoriesForFocus(focus: string): FocusCategory[] {
  return BUSINESS_FOCUS_CATEGORIES[focus] ?? [];
}
