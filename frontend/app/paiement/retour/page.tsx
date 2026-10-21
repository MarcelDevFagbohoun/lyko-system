import type { Metadata } from "next";
import { Suspense } from "react";
import { RetourView } from "./retour-view";

export const metadata: Metadata = { title: "Paiement" };

export default function RetourPage() {
  return (
    <Suspense fallback={null}>
      <RetourView />
    </Suspense>
  );
}
