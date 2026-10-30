import type { Metadata } from "next";
import { PlanningView } from "./planning-view";

export const metadata: Metadata = { title: "Planning" };

export default function PlanningPage() {
  return <PlanningView />;
}
