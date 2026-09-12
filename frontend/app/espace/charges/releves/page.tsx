import type { Metadata } from "next";
import { RelevesView } from "./releves-view";

export const metadata: Metadata = { title: "Relevés de compteurs" };

export default function RelevesPage() {
  return <RelevesView />;
}
