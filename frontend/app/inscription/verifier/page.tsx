import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifierView } from "./verifier-view";

export const metadata: Metadata = { title: "Confirmez votre email" };

export default function VerifierPage() {
  // useSearchParams() dans la vue : sans <Suspense>, le build de production échoue (pré-rendu statique).
  return (
    <Suspense fallback={null}>
      <VerifierView />
    </Suspense>
  );
}
