import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouvelle charge" };

export default function NouvelleChargePage() {
  return <NouveauView />;
}
