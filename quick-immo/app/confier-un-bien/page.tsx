"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { submitRequest, type RequestType } from "@/lib/api/accounts";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";

export default function ConfierUnBienPage() {
  const { account, accessToken, status } = useAuth();
  const [requestType, setRequestType] = React.useState<RequestType>("louer");
  const [address, setAddress] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitRequest(accessToken, { requestType, address, description: description || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer votre demande.");
    } finally {
      setSubmitting(false);
    }
  }

  const intro = (
    <div className="text-center">
      <h1 className="font-display text-headline-xl text-ink">Confier un bien</h1>
      <p className="mt-2 text-body-md text-ink-soft">
        Que vous souhaitiez louer ou vendre votre bien, décrivez-le ci-dessous — une agence partenaire vous
        recontacte rapidement pour en discuter. Aucun engagement à cette étape.
      </p>
      <p className="mt-2 text-body-xs text-ink-muted">
        Pour une location, la commission d&apos;agence ne peut jamais excéder 50 % du loyer.
      </p>
    </div>
  );

  let content: React.ReactNode;

  if (status === "loading") {
    content = <p className="text-center text-body-sm text-ink-muted">Chargement…</p>;
  } else if (status === "unauthenticated") {
    content = (
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body-md text-ink-soft">
            Créez un compte propriétaire (gratuit) pour envoyer votre demande et en suivre le statut.
          </p>
          <Link href="/inscription" className={buttonVariants({ variant: "primary" })}>
            Créer mon compte
          </Link>
          <p className="text-body-sm text-ink-muted">
            Déjà un compte ?{" "}
            <Link href="/connexion" className="font-label-md text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  } else if (account?.role !== "proprietaire") {
    content = (
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-body-md text-ink-soft">
            Cette page est réservée aux comptes propriétaires. Votre compte est enregistré comme « chercheur ».
          </p>
        </CardContent>
      </Card>
    );
  } else if (done) {
    content = (
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 size={32} className="text-success-fg" />
          <p className="font-label-md text-ink">Demande envoyée !</p>
          <p className="text-body-sm text-ink-soft">
            Une agence partenaire va l&apos;examiner et vous recontacter. Suivez son statut depuis votre compte.
          </p>
          <Link href="/mon-compte" className={buttonVariants({ variant: "primary" })}>
            Suivre ma demande
          </Link>
        </CardContent>
      </Card>
    );
  } else {
    content = (
      <Card className="mx-auto w-full max-w-md">
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-5">
            {error && (
              <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="font-label-sm text-ink-soft">Je souhaite…</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRequestType("louer")}
                  className={`rounded-lg border px-3 py-2 text-body-sm font-label-md ${
                    requestType === "louer" ? "border-primary bg-primary-bg text-primary" : "border-border-strong text-ink-soft"
                  }`}
                >
                  Louer mon bien
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType("vendre")}
                  className={`rounded-lg border px-3 py-2 text-body-sm font-label-md ${
                    requestType === "vendre" ? "border-primary bg-primary-bg text-primary" : "border-border-strong text-ink-soft"
                  }`}
                >
                  Vendre mon bien
                </button>
              </div>
            </div>
            <Field label="Adresse du bien" htmlFor="address" required hint="Ex. Cotonou, Fidjrossè">
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} required />
            </Field>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="description" className="font-label-sm text-ink-soft">
                Description (optionnel)
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Type de bien, nombre de pièces, état, prix souhaité…"
                className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Envoi…" : "Envoyer ma demande"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="flex-1">
        <div className="content-shell flex flex-col gap-8 py-12">
          {intro}
          {content}
        </div>
      </main>
      <Footer />
    </div>
  );
}
