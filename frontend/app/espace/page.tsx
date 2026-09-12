import type { Metadata } from "next";
import { EspaceView } from "./espace-view";

export const metadata: Metadata = { title: "Mon espace" };

export default function EspacePage() {
  return <EspaceView />;
}
