import type { Metadata } from "next";
import { PointView } from "./point-view";

export const metadata: Metadata = { title: "Le point des charges" };

export default function PointPage() {
  return <PointView />;
}
