import type { Metadata } from "next";
import { SalairesView } from "./salaires-view";

export const metadata: Metadata = { title: "Salaires" };

export default function SalairesPage() {
  return <SalairesView />;
}
