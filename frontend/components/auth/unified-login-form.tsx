"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Identifiant employé généré par la direction : 3 blocs de 4 caractères, ex. 7F3K-9QXM-2PTD (au moins une lettre). */
const EMPLOYEE_ID = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/i;
function isEmployeeIdentifier(v: string) {
  return EMPLOYEE_ID.test(v) && /[A-Z]/i.test(v);
}

/**
 * Connexion unifiée, sans choix de poste : un seul champ (téléphone, e-mail ou
 * identifiant employé) et le mot de passe. Le poste vient du compte, il n'est
 * affiché que dans les pages « utilisateurs » où la direction l'a enregistré.
 */
export function UnifiedLoginForm() {
  const { login, loginEmployee } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const employee = isEmployeeIdentifier(value.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (employee) {
        await loginEmployee(value.trim().toUpperCase(), password);
      } else {
        await login(value.trim(), password);
      }
      router.push(searchParams.get("next") || "/espace");
    } catch (err) {
      // Vérification d'email obligatoire (demande utilisateur, 2026-10-18) : le DG n'a jamais
      // saisi le code reçu à l'inscription — redirige directement vers cet écran plutôt que de
      // laisser une simple erreur sans suite (voir routes/auth.js, `details.code`).
      if (err instanceof ApiError && err.details?.code?.[0] === "email_not_verified") {
        const email = err.details.email?.[0];
        const params = new URLSearchParams({ reason: "unverified" });
        if (email) params.set("email", email);
        router.push(`/inscription/verifier?${params.toString()}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {error && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
          {error}
        </div>
      )}

      <Field
        label="Téléphone, e-mail ou identifiant"
        htmlFor="login"
        required
        hint="Direction : téléphone ou e-mail d’inscription. Employé : identifiant transmis par la direction (ex. 7F3K-9QXM-2PTD)"
      >
        <Input
          id="login"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="username"
          autoFocus
          className={employee ? "tabular uppercase tracking-wide" : undefined}
        />
      </Field>

      <Field label="Mot de passe" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Connexion…" : "Se connecter"}
      </Button>
      {!employee ? (
        <Link href="/mot-de-passe-oublie" className="text-center text-body-sm font-label-md text-primary hover:underline">
          Mot de passe oublié ?
        </Link>
      ) : (
        <p className="text-center text-body-sm text-ink-muted">
          Mot de passe oublié ? Demandez à votre administrateur de vous en attribuer un nouveau.
        </p>
      )}
    </form>
  );
}
