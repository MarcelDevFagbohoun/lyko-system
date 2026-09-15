"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ConnexionPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(phone, password);
      router.push("/mon-compte");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de se connecter.");
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
            <CardTitle>Se connecter</CardTitle>
            <CardDescription>Accédez à votre compte Quick Immo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {error}
                </div>
              )}
              <Field label="Numéro de téléphone" htmlFor="phone" required>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </Field>
              <Field label="Mot de passe" htmlFor="password" required>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Connexion…" : "Se connecter"}
              </Button>
              <p className="text-center text-body-sm text-ink-muted">
                Pas encore de compte ?{" "}
                <Link href="/inscription" className="font-label-md text-primary hover:underline">
                  Créer mon compte
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
