import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Ajouter un locataire" };

export default function NouveauLocatairePage() {
  return <NouveauView />;
}
