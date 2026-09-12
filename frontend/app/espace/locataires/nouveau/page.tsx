import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouveau locataire" };

export default function NouveauLocatairePage() {
  return <NouveauView />;
}
