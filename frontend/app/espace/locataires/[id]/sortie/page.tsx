import type { Metadata } from "next";
import { SortieView } from "./sortie-view";

export const metadata: Metadata = { title: "Sortie du locataire" };

export default function SortiePage() {
  return <SortieView />;
}
