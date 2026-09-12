import type { Metadata } from "next";
import { EditerView } from "./editer-view";

export const metadata: Metadata = { title: "Modifier un employé" };

export default function EditerEmployePage() {
  return <EditerView />;
}
