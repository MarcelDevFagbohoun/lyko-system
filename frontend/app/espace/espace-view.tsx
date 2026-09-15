"use client";

import Link from "next/link";
import { UserPlus, Building2, ArrowRight, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequireAuth } from "@/components/auth/require-auth";
import { MyTasksCard } from "@/components/espace/my-tasks-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * Espace principal après connexion (section 4.3) : état vide avec guide de
 * démarrage. « Ajouter mon premier employé » (étape 3) et « … mon premier
 * bien/locataire » (étape 4) sont désormais tous deux fonctionnels.
 */
export function EspaceView() {
  return (
    <RequireAuth>
      <EspaceContent />
    </RequireAuth>
  );
}

function EspaceContent() {
  const { user, tenant } = useAuth();
  const isDg = user?.role === "dg";
  const canLocataires = isDg || (user?.permissions.includes("locataires") ?? false);
  const canPayments = canLocataires || (user?.permissions.includes("comptabilite") ?? false);

  return (
    <div className="min-h-screen bg-canvas">

      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Bienvenue, {user?.firstName} 👋</h1>
          <p className="text-body-lg text-ink-soft">
            Votre espace {tenant?.companyName} est prêt. Voici pour commencer :
          </p>
        </div>

        {!isDg && <MyTasksCard />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isDg && (
            <Link href="/espace/employes" className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                    <UserPlus size={20} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Ajouter mon premier employé</CardTitle>
                    <ArrowRight size={16} className="text-ink-muted transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <CardDescription>
                    Créez des comptes agent et comptable avec des permissions précises.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}

          {canLocataires ? (
            <>
              <Link href="/espace/biens/nouveau" className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader>
                    <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                      <Building2 size={20} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>Ajouter mon premier bien</CardTitle>
                      <ArrowRight size={16} className="text-ink-muted transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <CardDescription>Immeuble, villa ou maison, avec ses unités locatives.</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
              <Link href="/espace/locataires/nouveau" className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader>
                    <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                      <UserPlus size={20} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>Ajouter mon premier locataire</CardTitle>
                      <ArrowRight size={16} className="text-ink-muted transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <CardDescription>Nécessite une unité libre sur un bien existant.</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </>
          ) : canPayments ? (
            <Link href="/espace/locataires" className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                    <Receipt size={20} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Enregistrer un paiement</CardTitle>
                    <ArrowRight size={16} className="text-ink-muted transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <CardDescription>
                    Retrouvez un locataire pour enregistrer un paiement et générer sa quittance.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ) : (
            <Card className="opacity-80">
              <CardHeader>
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-primary">
                  <Building2 size={20} />
                </div>
                <CardTitle>Biens & locataires</CardTitle>
                <CardDescription>Vous n&apos;avez pas accès à ce module pour le moment.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        {!isDg && user && user.permissions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Vos accès</CardTitle>
              <CardDescription>
                Modules autorisés par votre direction générale. Ils s&apos;activeront au fil de la
                construction de chaque module.
              </CardDescription>
            </CardHeader>
            <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
              {user.permissions.map((key) => (
                <Badge key={key} variant="info">
                  {key.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
