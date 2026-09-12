import type { Metadata } from "next";
import { BiensView } from "./biens-view";

export const metadata: Metadata = { title: "Nos biens" };

export default function BiensPage() {
  return <BiensView />;
}
