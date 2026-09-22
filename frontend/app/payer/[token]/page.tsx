import type { Metadata } from "next";
import { PayerView } from "./payer-view";

export const metadata: Metadata = { title: "Payer en ligne" };

export default function PayerPage() {
  return <PayerView />;
}
