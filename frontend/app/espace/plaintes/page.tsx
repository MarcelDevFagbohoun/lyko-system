import type { Metadata } from "next";
import { PlaintesView } from "./plaintes-view";

export const metadata: Metadata = { title: "Plaintes & réclamations" };

export default function PlaintesPage() {
  return <PlaintesView />;
}
