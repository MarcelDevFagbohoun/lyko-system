import type { Metadata } from "next";
import { NouveauView } from "./nouveau-view";

export const metadata: Metadata = { title: "Nouvelle plainte" };

export default function NouveauPlaintePage() {
  return <NouveauView />;
}
