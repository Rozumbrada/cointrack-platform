import { redirect } from "next/navigation";

export default function AppRoot() {
  // Po loginu vždy projít přes výběr profilu — ten pak rozhodne kam dál
  // (auto-select pokud je default nastavený nebo má jen 1 profil).
  redirect("/app/profiles");
}
