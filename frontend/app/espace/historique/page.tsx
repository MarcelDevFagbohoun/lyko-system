import type { Metadata } from "next";
import { HistoriqueView } from "./historique-view";

export const metadata: Metadata = { title: "Mon historique" };

export default function HistoriquePage() {
  return <HistoriqueView />;
}
