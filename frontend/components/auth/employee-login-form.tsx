"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const POSTES = [
  { value: "agent", label: "Agent" },
  { value: "comptable", label: "Comptable" },
] as const;

/** Connexion employé : identifiant généré à la création + poste + mot de passe. */
export function EmployeeLoginForm() {
  const { loginEmployee } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = React.useState("");
  const [role, setRole] = React.useState<"agent" | "comptable">("agent");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginEmployee(identifier.trim(), role, password);
      router.push(searchParams.get("next") || "/espace");
    } catch (err) {
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
        label="Identifiant"
        htmlFor="identifier"
        required
        hint="Transmis par votre direction générale, ex. 7F3K-9QXM"
      >
        <Input
          id="identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
          autoComplete="username"
          autoFocus
          className="tabular uppercase tracking-wide"
        />
      </Field>

      <Field label="Poste" htmlFor="role" required>
        <div className="flex gap-2">
          {POSTES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setRole(p.value)}
              className={`flex-1 rounded-lg border px-3 py-2 font-label-md transition-colors ${
                role === p.value
                  ? "border-primary bg-surface-muted text-ink"
                  : "border-border text-ink-soft hover:bg-surface-hover"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
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
    </form>
  );
}
