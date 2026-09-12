import type { Metadata } from "next";
import { ChargesView } from "./charges-view";

export const metadata: Metadata = { title: "Charges SONEB & SBEE" };

export default function ChargesPage() {
  return <ChargesView />;
}
