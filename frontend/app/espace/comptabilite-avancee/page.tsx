import type { Metadata } from "next";
import { GlAvanceeView } from "./comptabilite-avancee-view";

export const metadata: Metadata = { title: "Comptabilité avancée" };

export default function ComptabiliteAvanceePage() {
  return <GlAvanceeView />;
}
