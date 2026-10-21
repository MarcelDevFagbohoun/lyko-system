import type { Metadata } from "next";
import { VerifierView } from "./verifier-view";

export const metadata: Metadata = { title: "Confirmez votre email" };

export default function VerifierPage() {
  return <VerifierView />;
}
