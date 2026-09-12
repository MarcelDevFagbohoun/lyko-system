import type { Metadata } from "next";
import { TableauDeBordView } from "./tableau-de-bord-view";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function TableauDeBordPage() {
  return <TableauDeBordView />;
}
