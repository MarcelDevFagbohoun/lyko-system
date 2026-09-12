"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PASSWORD_RE, passwordStrength } from "@/lib/validation/auth";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function strengthColor(score: number) {
  if (score <= 2) return "bg-danger";
  if (score <= 3) return "bg-warning";
  return "bg-success";
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const strength = passwordStrength(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;
  const isValid =
    currentPassword.length > 0 && PASSWORD_RE.test(newPassword) && confirmPassword === newPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      onDone();
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

      <Field label="Mot de passe actuel (temporaire)" htmlFor="currentPassword" required>
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Field
          label="Nouveau mot de passe"
          htmlFor="newPassword"
          required
          hint="10 caractères min., majuscule, minuscule, chiffre, caractère spécial"
        >
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {newPassword.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full ${i < strength.score ? strengthColor(strength.score) : "bg-surface-muted"}`}
                />
              ))}
            </div>
            <span className="text-body-xs text-ink-muted">{strength.label}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Confirmation du nouveau mot de passe" htmlFor="confirmPassword" required>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {confirmPassword.length > 0 && (
          <p className={`text-body-xs ${passwordsMatch ? "text-success-fg" : "text-danger-fg"}`}>
            {passwordsMatch ? "Les mots de passe correspondent ✓" : "Les mots de passe ne correspondent pas"}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Mise à jour…" : "Changer mon mot de passe"}
      </Button>
    </form>
  );
}
