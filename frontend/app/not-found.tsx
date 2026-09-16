"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 générique — s'applique à toute URL qui ne correspond à aucune route
 * (marketing, connexion/inscription, portails...). `app/espace/not-found.tsx`
 * prend le relais à l'intérieur de l'espace connecté (menu vertical conservé) ;
 * celle-ci ne sert donc jamais à un utilisateur déjà dans son espace.
 *
 * Le message et le bouton s'adaptent à la session : un utilisateur déjà
 * connecté est renvoyé vers son espace, jamais vers la page de connexion
 * (qui le renverrait de toute façon directement à /espace).
 */
export default function NotFound() {
  const { status } = useAuth();
  const isAuthenticated = status === "authenticated";

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg text-primary">
            <FileQuestion size={30} />
          </span>
          <div>
            <h1 className="font-display text-headline-xl text-ink">Page introuvable</h1>
            <p className="mt-2 text-body-md text-ink-soft">
              Cette adresse n&apos;existe pas ou n&apos;existe plus. Vérifiez le lien, ou repartez
              d&apos;une page valide ci-dessous.
            </p>
          </div>
          <Link href={isAuthenticated ? "/espace" : "/"} className={buttonVariants({ variant: "primary", size: "lg" })}>
            {isAuthenticated ? "Retourner à mon espace" : "Retourner à l'accueil"}
          </Link>
          {!isAuthenticated && (
            <Link href="/connexion" className="text-body-sm text-ink-muted hover:text-ink hover:underline">
              Ou se connecter à un espace existant
            </Link>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
