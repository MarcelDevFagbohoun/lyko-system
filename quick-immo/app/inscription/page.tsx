"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import type { AccountRole } from "@/lib/api/accounts";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function InscriptionPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [role, setRole] = React.useState<AccountRole>("chercheur");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ role, firstName, lastName, phone, password });
      router.push("/mon-compte");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer le compte.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="flex flex-1 items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Créer mon compte</CardTitle>
            <CardDescription>Pour chercher un logement ou confier un bien à une agence partenaire.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="font-label-sm text-ink-soft">Je suis…</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole("chercheur")}
                    className={`rounded-lg border px-3 py-2 text-body-sm font-label-md ${
                      role === "chercheur"
                        ? "border-primary bg-primary-bg text-primary"
                        : "border-border-strong text-ink-soft"
                    }`}
                  >
                    À la recherche d&apos;un bien
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("proprietaire")}
                    className={`rounded-lg border px-3 py-2 text-body-sm font-label-md ${
                      role === "proprietaire"
                        ? "border-primary bg-primary-bg text-primary"
                        : "border-border-strong text-ink-soft"
                    }`}
                  >
                    Propriétaire d&apos;un bien
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Prénom" htmlFor="firstName" required>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </Field>
                <Field label="Nom" htmlFor="lastName" required>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </Field>
              </div>
              <Field label="Numéro de téléphone" htmlFor="phone" required hint="Ex. 0161234567">
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </Field>
              <Field
                label="Mot de passe"
                htmlFor="password"
                required
                hint="Au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial."
              >
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>

              <Button type="submit" disabled={submitting}>
                {submitting ? "Création…" : "Créer mon compte"}
              </Button>

              <p className="text-center text-body-sm text-ink-muted">
                Déjà un compte ?{" "}
                <Link href="/connexion" className="font-label-md text-primary hover:underline">
                  Se connecter
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
