"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { LykoLogo } from "@/components/brand/logo";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

/**
 * Changement de mot de passe obligatoire à la première connexion (section 5).
 * Volontairement hors de <RequireAuth> pour éviter la boucle de redirection
 * qu'il déclenche tant que mustChangePassword est vrai.
 */
export function ChangerVue() {
  const { status, user } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/connexion");
  }, [status, router]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <ConnectionIndicator />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-topbar items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
        <LykoLogo />
        <ConnectionIndicator />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            {user?.mustChangePassword && (
              <Badge variant="warning" className="mb-2 w-fit">
                Obligatoire avant de continuer
              </Badge>
            )}
            <CardTitle>Changer mon mot de passe</CardTitle>
            <CardDescription>
              {user?.mustChangePassword
                ? "Votre mot de passe temporaire doit être remplacé avant d'accéder à votre espace."
                : "Choisissez un nouveau mot de passe pour votre compte."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm onDone={() => router.replace("/espace")} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
