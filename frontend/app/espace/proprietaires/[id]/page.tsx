import type { Metadata } from "next";
import { ProprietaireView } from "./proprietaire-view";

export const metadata: Metadata = { title: "Fiche du propriétaire" };

export default function ProprietairePage() {
  return <ProprietaireView />;
}
