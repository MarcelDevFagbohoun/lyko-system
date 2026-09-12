import type { Metadata } from "next";
import { ProprietairesView } from "./proprietaires-view";

export const metadata: Metadata = { title: "Gestion Propriétaires" };

export default function ProprietairesPage() {
  return <ProprietairesView />;
}
