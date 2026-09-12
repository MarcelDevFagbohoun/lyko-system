import type { Metadata } from "next";
import { ParametresView } from "./parametres-view";

export const metadata: Metadata = { title: "Paramètres" };

export default function ParametresPage() {
  return <ParametresView />;
}
