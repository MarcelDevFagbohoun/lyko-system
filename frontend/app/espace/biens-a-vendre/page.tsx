import type { Metadata } from "next";
import { BiensAVendreView } from "./biens-a-vendre-view";

export const metadata: Metadata = { title: "Biens à vendre" };

export default function BiensAVendrePage() {
  return <BiensAVendreView />;
}
