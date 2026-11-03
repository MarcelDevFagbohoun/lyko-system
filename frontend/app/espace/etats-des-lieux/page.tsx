import type { Metadata } from "next";
import { EtatsDesLieuxView } from "./etats-des-lieux-view";

export const metadata: Metadata = { title: "État des lieux" };

export default function EtatsDesLieuxPage() {
  return <EtatsDesLieuxView />;
}
