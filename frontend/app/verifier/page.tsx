import type { Metadata } from "next";
import { VerifierView } from "./verifier-view";

export const metadata: Metadata = {
  title: "Vérifier un document",
  description: "Confirmez l'authenticité d'une quittance, d'un contrat de bail ou d'un relevé Lyko System à partir de son code de vérification.",
};

export default function VerifierPage() {
  return <VerifierView />;
}
