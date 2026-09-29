import type { Metadata } from "next";
import { Suspense } from "react";
import { ContratView } from "./contrat-view";

export const metadata: Metadata = { title: "Contrat de bail" };

export default function ContratPage() {
  return (
    <Suspense fallback={null}>
      <ContratView />
    </Suspense>
  );
}
