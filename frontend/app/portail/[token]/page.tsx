import type { Metadata } from "next";
import { PortailView } from "./portail-view";

export const metadata: Metadata = { title: "Mon espace locataire" };

export default function PortailPage() {
  return <PortailView />;
}
