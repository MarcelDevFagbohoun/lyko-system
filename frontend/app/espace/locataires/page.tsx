import type { Metadata } from "next";
import { LocatairesView } from "./locataires-view";

export const metadata: Metadata = { title: "Gestion Locataires" };

export default function LocatairesPage() {
  return <LocatairesView />;
}
