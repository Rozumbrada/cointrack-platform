import { redirect } from "next/navigation";

// Skupinové profily jsou součástí Organizací — přesměrujeme tam.
export default function GroupsRedirect() {
  redirect("/app/organizations");
}
