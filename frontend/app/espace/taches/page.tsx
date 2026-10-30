import { redirect } from "next/navigation";

// Ancienne page « Tâches » : remplacée par le Planning (2026-10-30).
export default function TachesRedirect() {
  redirect("/espace/planning");
}
