import type { Metadata } from "next";
import { ClotureView } from "./cloture-view";

export const metadata: Metadata = { title: "Clôture des mois" };

export default function CloturePage() {
  return <ClotureView />;
}
