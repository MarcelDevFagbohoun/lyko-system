import type { Metadata } from "next";
import { AnnulationView } from "./annulation-view";

export const metadata: Metadata = { title: "Annuler mon abonnement" };

export default function AnnulationPage() {
  return <AnnulationView />;
}
