import type { Metadata } from "next";
import { Suspense } from "react";
import { EtatDesLieuxView } from "./etat-des-lieux-view";

export const metadata: Metadata = { title: "État des lieux" };

export default function EtatDesLieuxPage() {
  return (
    <Suspense fallback={null}>
      <EtatDesLieuxView />
    </Suspense>
  );
}
