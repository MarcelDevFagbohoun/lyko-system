import type { Metadata } from "next";
import { MotDePasseOublieView } from "./mot-de-passe-oublie-view";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function MotDePasseOubliePage() {
  return <MotDePasseOublieView />;
}
