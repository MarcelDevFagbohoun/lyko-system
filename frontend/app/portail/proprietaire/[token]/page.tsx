import type { Metadata } from "next";
import { OwnerPortailView } from "./owner-portail-view";

export const metadata: Metadata = { title: "Mon espace propriétaire" };

export default function OwnerPortailPage() {
  return <OwnerPortailView />;
}
