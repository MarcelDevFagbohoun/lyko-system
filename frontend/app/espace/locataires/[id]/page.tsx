import type { Metadata } from "next";
import { LocataireView } from "./locataire-view";

export const metadata: Metadata = { title: "Fiche locataire" };

export default function LocatairePage() {
  return <LocataireView />;
}
