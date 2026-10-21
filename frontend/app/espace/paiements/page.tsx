import type { Metadata } from "next";
import { PaiementsView } from "./paiements-view";

export const metadata: Metadata = { title: "Paiements" };

export default function PaiementsPage() {
  return <PaiementsView />;
}
