import type { Metadata } from "next";
import { JournalView } from "./journal-view";

export const metadata: Metadata = { title: "Journal d'activité" };

export default function JournalPage() {
  return <JournalView />;
}
