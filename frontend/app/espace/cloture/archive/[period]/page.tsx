import type { Metadata } from "next";
import { ArchiveMensuelleView } from "./archive-mensuelle-view";

export const metadata: Metadata = { title: "Archive mensuelle" };

export default function ArchiveMensuellePage() {
  return <ArchiveMensuelleView />;
}
