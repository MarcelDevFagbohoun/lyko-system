import type { Metadata } from "next";
import { BienView } from "./bien-view";

export const metadata: Metadata = { title: "Fiche du bien" };

export default function BienPage() {
  return <BienView />;
}
