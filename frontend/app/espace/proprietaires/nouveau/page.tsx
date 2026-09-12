import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouveau propriétaire" };

export default function NouveauProprietairePage() {
  return <NouveauView />;
}
