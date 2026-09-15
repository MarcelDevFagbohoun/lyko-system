import type { Metadata } from "next";
import { MarketplaceView } from "./marketplace-view";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return <MarketplaceView />;
}
