"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { EspaceSidebar } from "@/components/espace/espace-sidebar";
import { CardToneProvider } from "@/components/ui/card";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { CADRES, cadreForPath } from "@/lib/module-theme";
import { cn } from "@/lib/utils";

/**
 * Coquille commune à tout l'espace connecté (`/espace/**`) : menu vertical
 * fixe + zone de contenu décalée d'autant à partir de `lg` (auparavant, un
 * en-tête horizontal répété individuellement dans chacune des 29 pages —
 * un seul point d'entrée désormais, voir `EspaceSidebar`).
 *
 * Le décalage `lg:pl-sidebar` n'est appliqué qu'une fois authentifié — sinon
 * l'écran de chargement/accès refusé de `RequireAuth` (dans chaque page,
 * centré sur toute la largeur) se retrouverait décalé à droite pendant que
 * `EspaceSidebar` ne rend encore rien.
 *
 * La couleur de fond des cartes et le filet du haut viennent du « cadre » de la page (rubrique du
 * menu — voir `lib/module-theme.ts`).
 *
 * `key={pathname}` sur `<main>` : sans lui, cet élément ne serait monté
 * qu'une fois (il appartient à la coquille, stable entre navigations) et le
 * fondu d'entrée (`animate-page-in`) ne jouerait qu'au premier chargement —
 * la clé force un remontage à chaque changement de page.
 */
export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useAuth();
  const cadre = CADRES[cadreForPath(pathname)];

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceSidebar />
      <main key={pathname} className={cn("animate-page-in", status === "authenticated" && "lg:pl-sidebar")}>
        {/* Filet de la couleur du cadre : dit d'un coup d'œil dans quelle rubrique du menu l'on se trouve. */}
        {status === "authenticated" && <div aria-hidden className={cn("h-1 w-full", cadre.solid)} />}
        <CardToneProvider tone={cadre.tone}>{children}</CardToneProvider>
      </main>
      {status === "authenticated" && <AssistantWidget />}
    </div>
  );
}
