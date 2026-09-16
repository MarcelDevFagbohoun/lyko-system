import type { Metadata } from "next";
import { MonCompteView } from "./mon-compte-view";

export const metadata: Metadata = { title: "Mon compte" };

export default function MonComptePage() {
  return <MonCompteView />;
}
