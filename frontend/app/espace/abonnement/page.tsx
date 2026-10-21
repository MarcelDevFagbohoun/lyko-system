import type { Metadata } from "next";
import { AbonnementView } from "./abonnement-view";

export const metadata: Metadata = { title: "Abonnement" };

export default function AbonnementPage() {
  return <AbonnementView />;
}
