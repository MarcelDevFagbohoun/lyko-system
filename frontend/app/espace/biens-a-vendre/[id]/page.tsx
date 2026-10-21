import type { Metadata } from "next";
import { BienAVendreView } from "./bien-a-vendre-view";

export const metadata: Metadata = { title: "Bien à vendre" };

export default function BienAVendrePage() {
  return <BienAVendreView />;
}
