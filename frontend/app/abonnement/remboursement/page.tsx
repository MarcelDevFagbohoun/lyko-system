import type { Metadata } from "next";
import { Suspense } from "react";
import { RemboursementView } from "./remboursement-view";

export const metadata: Metadata = { title: "Remboursement" };

export default function RemboursementPage() {
  return (
    <Suspense fallback={null}>
      <RemboursementView />
    </Suspense>
  );
}
