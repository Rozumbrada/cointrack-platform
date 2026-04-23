import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SITE = {
  name: "Cointrack",
  tagline: "Přehled nad financemi na všech zařízeních",
  description:
    "Cointrack je finanční asistent pro osobní i firemní účty. Automatické napojení bank, skenování účtenek, správa faktur. Android, iOS, web.",
  url: "https://cointrack.cz",
  supportEmail: "support@cointrack.cz",
  twitter: "@cointrack_cz",
};
