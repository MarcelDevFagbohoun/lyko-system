import type { Metadata } from "next";
import { RelancesView } from "./relances-view";

export const metadata: Metadata = { title: "Centre de relance" };

export default function RelancesPage() {
  return <RelancesView />;
}
