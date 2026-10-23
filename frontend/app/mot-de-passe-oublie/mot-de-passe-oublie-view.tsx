"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PASSWORD_RE } from "@/lib/validation/auth";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

const json = { "Content-Type": "application/json" };

/** Mot de passe oublié de l'administrateur : code à 8 chiffres reçu par e-mail, puis nouveau mot de passe. */
export function MotDePasseOublieView() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Saisissez une adresse e-mail valide.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/forgot-password", { method: "POST", headers: json, body: JSON.stringify({ email: email.trim() }) });
      setStep("code");
      toast.success("Si un compte administrateur existe pour cet e-mail, un code vient d'y être envoyé.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 8) return setError("Le code comporte 8 chiffres.");
    if (!PASSWORD_RE.test(password)) return setError("Mot de passe : 10 caractères min., majuscule, minuscule, chiffre, caractère spécial.");
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email: email.trim(), code, newPassword: password, confirmNewPassword: confirm }),
      });
      toast.success("Mot de passe modifié. Connectez-vous avec le nouveau.");
      router.push("/connexion");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <div className="content-shell flex items-center justify-center py-16 sm:py-24">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Mot de passe oublié</CardTitle>
              <CardDescription>
                {step === "email"
                  ? "Réservé à l'administrateur. Saisissez l'e-mail de votre compte : nous vous envoyons un code de vérification."
                  : "Saisissez le code à 8 chiffres reçu par e-mail (valable 15 minutes) et choisissez un nouveau mot de passe."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={step === "email" ? sendCode : reset} className="flex flex-col gap-5" noValidate>
                {error && (
                  <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
                )}
                <Field label="E-mail" htmlFor="email" required>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={step === "code"} autoFocus />
                </Field>
                {step === "code" && (
                  <>
                    <Field label="Code à 8 chiffres" htmlFor="code" required>
                      <Input
                        id="code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                        inputMode="numeric"
                        maxLength={8}
                        autoComplete="one-time-code"
                        className="tabular tracking-widest"
                      />
                    </Field>
                    <Field label="Nouveau mot de passe" htmlFor="password" required hint="10 caractères min., majuscule, minuscule, chiffre, caractère spécial">
                      <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                    </Field>
                    <Field label="Confirmer le mot de passe" htmlFor="confirm" required>
                      <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                    </Field>
                  </>
                )}
                <Button type="submit" size="lg" disabled={busy}>
                  {busy ? "Patientez…" : step === "email" ? "Envoyer le code" : "Modifier mon mot de passe"}
                </Button>
                {step === "code" && (
                  <Button type="button" variant="ghost" onClick={() => sendCode()} disabled={busy}>
                    Renvoyer un code
                  </Button>
                )}
                <Link href="/connexion" className="text-center text-body-sm text-ink-muted hover:text-ink">
                  Retour à la connexion
                </Link>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
