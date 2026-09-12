import type { Metadata } from "next";
import { EmployesView } from "./employes-view";

export const metadata: Metadata = { title: "Gestion des employés" };

export default function EmployesPage() {
  return <EmployesView />;
}
