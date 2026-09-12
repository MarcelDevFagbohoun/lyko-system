import type { Metadata } from "next";
import { ReleveView } from "./releve-view";

export const metadata: Metadata = { title: "Relevé de compteurs" };

export default function RelevePage() {
  return <ReleveView />;
}
