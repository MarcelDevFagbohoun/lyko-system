import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouveau bien" };

export default function NouveauBienPage() {
  return <NouveauView />;
}
