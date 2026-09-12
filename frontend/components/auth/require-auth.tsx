"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth, type AuthUser } from "@/lib/auth/auth-context";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <ConnectionIndicator />
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas px-4 text-center">
      <Badge variant="danger">Accès refusé</Badge>
      <h1 className="font-display text-headline-lg text-ink">Vous n&apos;avez pas accès à cette page</h1>
      <p className="max-w-sm text-body-md text-ink-soft">
        Cette section est réservée à un autre rôle. Contactez votre direction si vous pensez
        qu&apos;il s&apos;agit d&apos;une erreur.
      </p>
      <Link href="/espace" className={buttonVariants({ variant: "secondary" })}>
        Retour à mon espace
      </Link>
    </div>
  );
}

/**
 * Protège une page cliente :
 * - redirige vers /connexion si la session n'est pas authentifiée ;
 * - redirige vers /changer-mot-de-passe si un mot de passe temporaire est
 *   toujours actif (section 5 : changement obligatoire à la première connexion) ;
 * - affiche un accès refusé si `roles` est fourni et ne couvre pas le rôle courant ;
 * - affiche un accès refusé si `permission` est fourni et qu'aucune des
 *   permissions listées n'est présente chez l'utilisateur (le DG passe
 *   toujours, comme côté backend). Un tableau = accès autorisé dès qu'une
 *   des permissions est présente (ex. paiements = locataires OU comptabilite).
 */
export function RequireAuth({
  children,
  roles,
  permission,
}: {
  children: React.ReactNode;
  roles?: AuthUser["role"][];
  permission?: string | string[];
}) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const mustChangePassword = user?.mustChangePassword && pathname !== "/changer-mot-de-passe";

  React.useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/connexion?next=${encodeURIComponent(pathname)}`);
    } else if (status === "authenticated" && mustChangePassword) {
      router.replace("/changer-mot-de-passe");
    }
  }, [status, mustChangePassword, router, pathname]);

  if (status === "loading" || status === "unauthenticated" || mustChangePassword) {
    return <LoadingScreen />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <AccessDenied />;
  }

  if (permission && user && user.role !== "dg") {
    const required = Array.isArray(permission) ? permission : [permission];
    if (!required.some((p) => user.permissions.includes(p))) {
      return <AccessDenied />;
    }
  }

  return <>{children}</>;
}
