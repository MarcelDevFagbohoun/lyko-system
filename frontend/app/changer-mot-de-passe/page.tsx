import type { Metadata } from "next";
import { ChangerVue } from "./changer-view";

export const metadata: Metadata = { title: "Changer mon mot de passe" };

export default function ChangerMotDePassePage() {
  return <ChangerVue />;
}
