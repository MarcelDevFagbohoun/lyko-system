"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Role = "dg" | "comptable" | "agent";

const DEFAULT_LABELS: Record<Role, string> = { dg: "Admin", comptable: "Comptable", agent: "Agent" };

/**
 * Connexion unifiée : un seul formulaire, un menu déroulant « Poste »
 * listant les 3 rôles (DG compris, plus seulement comptable/agent) — au
 * lieu des deux onglets séparés Direction/Employé d'avant (demande directe
 * de l'utilisateur : « plusieurs postes au niveau du menu »). Le DG se
 * connecte par téléphone, l'employé par identifiant — seul le champ
 * affiché change selon le poste choisi, jamais le mécanisme d'authentification
 * sous-jacent (toujours `login()` pour dg, `loginEmployee()` sinon).
 */
export function UnifiedLoginForm() {
  const { login, loginEmployee } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [role, setRole] = React.useState<Role>("dg");
  const [phone, setPhone] = React.useState("");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Libellés personnalisés (Réglages) de l'entreprise correspondant à
  // l'identifiant/numéro déjà saisi — inconnu avant ça, on retombe sur les
  // libellés par défaut jusqu'à la réponse (jamais bloquant).
  const [roleLabels, setRoleLabels] = React.useState<Record<Role, string>>(DEFAULT_LABELS);

  React.useEffect(() => {
    const value = role === "dg" ? phone.trim() : identifier.trim();
    if (!value) {
      setRoleLabels(DEFAULT_LABELS);
      return;
    }
    const param = role === "dg" ? `phone=${encodeURIComponent(value)}` : `identifier=${encodeURIComponent(value)}`;
    const timer = setTimeout(() => {
      apiFetch<Record<Role, string>>(`/api/auth/role-titles?${param}`)
        .then((res) => setRoleLabels(res))
        .catch(() => setRoleLabels(DEFAULT_LABELS));
    }, 350);
    return () => clearTimeout(timer);
  }, [role, phone, identifier]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (role === "dg") {
        await login(phone.trim(), password);
      } else {
        await loginEmployee(identifier.trim(), role, password);
      }
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

      <Field label="Poste" htmlFor="role" required>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="h-[42px] w-full rounded-lg border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {(["dg", "comptable", "agent"] as const).map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </select>
      </Field>

      {role === "dg" ? (
        <Field label="Numéro de téléphone" htmlFor="phone" required>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            autoFocus
          />
        </Field>
      ) : (
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
            className="tabular uppercase tracking-wide"
          />
        </Field>
      )}

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
