import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Créer mon compte" };

/**
 * Inscription de l'entreprise (section 4.2) — le compte créé reçoit
 * automatiquement le rôle DG et un espace cloisonné (section 4.3).
 */
export default function InscriptionPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="content-shell flex items-center justify-center py-12 sm:py-16">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle>Créer le compte de mon entreprise</CardTitle>
              <CardDescription>
                Vous créez l&apos;espace de votre entreprise. Ce compte reçoit automatiquement le
                rôle Admin, avec tous les droits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RegisterForm />
              <p className="mt-4 text-center text-body-sm text-ink-muted">
                Déjà inscrit ?{" "}
                <Link href="/connexion" className="font-label-md text-primary hover:underline">
                  Se connecter
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
