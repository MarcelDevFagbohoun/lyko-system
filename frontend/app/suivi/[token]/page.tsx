import type { Metadata } from "next";
import { SuiviView } from "./suivi-view";

// Page privée : lien secret, jamais indexée.
export const metadata: Metadata = { title: "Suivi de ma réclamation", robots: { index: false, follow: false } };

export default function SuiviPage() {
  return <SuiviView />;
}
