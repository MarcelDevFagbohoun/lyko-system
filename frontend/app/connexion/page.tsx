import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LoginTabs } from "@/components/auth/login-tabs";

export const metadata: Metadata = { title: "Se connecter" };

export default function ConnexionPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="content-shell flex items-center justify-center py-16 sm:py-24">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Se connecter à mon espace</CardTitle>
              <CardDescription>Accédez à l&apos;espace de votre entreprise.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={null}>
                <LoginTabs />
              </Suspense>
              <p className="mt-4 text-center text-body-sm text-ink-muted">
                Pas encore de compte ?{" "}
                <Link href="/inscription" className="font-label-md text-primary hover:underline">
                  Créer mon compte
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
