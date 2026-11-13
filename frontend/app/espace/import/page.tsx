import type { Metadata } from "next";
import { ImportView } from "./import-view";

export const metadata: Metadata = { title: "Importer depuis Excel" };

export default function ImportPage() {
  return <ImportView />;
}
