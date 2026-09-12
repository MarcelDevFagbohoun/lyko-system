import type { Metadata } from "next";
import { PlainteView } from "./plainte-view";

export const metadata: Metadata = { title: "Dossier de plainte" };

export default function PlaintePage() {
  return <PlainteView />;
}
