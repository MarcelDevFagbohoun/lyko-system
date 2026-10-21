"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Vérification d'email obligatoire à l'inscription (demande utilisateur, 2026-10-18) : code à 8
 * chiffres reçu par email (Resend), saisi ici pour activer le compte — tant que ce n'est pas
 * fait, la connexion normale (`/connexion`) redirige automatiquement ici (voir
 * `unified-login-form.tsx`).
 */
export function VerifierView() {
  const { verifyEmail, resendVerificationCode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState(searchParams.get("email") ?? "");
  const [code, setCode] = React.useState("");
  // Redirigé ici depuis une tentative de connexion bloquée (demande utilisateur, 2026-10-18) —
  // sans ce bandeau, l'écran est indiscernable d'une première visite après inscription,
  // confusant pour qui ne s'attendait pas à être redirigé (signalé en vérification live).
  const unverifiedRedirect = searchParams.get("reason") === "unverified";
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyEmail(email.trim().toLowerCase(), code.trim());
      router.push("/espace");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!email.trim()) {
      setError("Saisissez votre email pour recevoir un nouveau code.");
      return;
    }
    setResending(true);
    setError(null);
    try {
      await resendVerificationCode(email.trim().toLowerCase());
      toast.success("Si un compte en attente existe pour cet email, un nouveau code vient d'être envoyé.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="content-shell flex items-center justify-center py-12 sm:py-16">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Confirmez votre email</CardTitle>
              <CardDescription>
                Saisissez le code à 8 chiffres reçu par email pour activer votre compte. Il expire
                après 15 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                {unverifiedRedirect && !error && (
                  <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-sm text-warning-fg">
                    Votre email n&apos;est pas encore confirmé — saisissez le code reçu pour activer votre compte.
                  </div>
                )}
                {error && (
                  <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                    {error}
                  </div>
                )}

                <Field label="Email" htmlFor="email" required>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </Field>

                <Field label="Code à 8 chiffres" htmlFor="code" required>
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    maxLength={8}
                    className="tabular text-center text-headline-sm tracking-[0.3em]"
                    autoFocus
                  />
                </Field>

                <Button type="submit" size="lg" disabled={submitting || code.length !== 8 || !email.trim()}>
                  {submitting ? "Vérification…" : "Vérifier"}
                </Button>

                <Button type="button" variant="ghost" onClick={handleResend} disabled={resending}>
                  {resending ? "Envoi…" : "Renvoyer le code"}
                </Button>
              </form>

              <p className="mt-4 text-center text-body-sm text-ink-muted">
                <Link href="/connexion" className="font-label-md text-primary hover:underline">
                  Retour à la connexion
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
