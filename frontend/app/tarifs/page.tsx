import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { TarifsView } from "./tarifs-view";

export const metadata: Metadata = { title: "Tarifs" };

export default function TarifsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <TarifsView />
      </main>
      <SiteFooter />
    </div>
  );
}
