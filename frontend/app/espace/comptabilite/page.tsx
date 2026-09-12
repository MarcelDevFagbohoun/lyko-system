import type { Metadata } from "next";
import { ComptabiliteView } from "./comptabilite-view";

export const metadata: Metadata = { title: "Comptabilité" };

export default function ComptabilitePage() {
  return <ComptabiliteView />;
}
