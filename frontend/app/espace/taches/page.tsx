import type { Metadata } from "next";
import { TachesView } from "./taches-view";

export const metadata: Metadata = { title: "Tâches" };

export default function TachesPage() {
  return <TachesView />;
}
