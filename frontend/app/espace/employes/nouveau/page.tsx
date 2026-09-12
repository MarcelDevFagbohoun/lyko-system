import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouvel employé" };

export default function NouvelEmployePage() {
  return <NouveauView />;
}
