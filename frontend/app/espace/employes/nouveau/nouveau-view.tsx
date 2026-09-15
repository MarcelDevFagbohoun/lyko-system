"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, Check, ArrowLeft, MessageCircle, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  createEmployee,
  fetchPermissionCatalog,
  type PermissionCatalogEntry,
  type PermissionKey,
  type EmployeeRole,
} from "@/lib/api/employees";
import { normalizeBeninPhone, toE164Benin } from "@/lib/validation/auth";
import { RequireAuth } from "@/components/auth/require-auth";
import { PermissionPicker } from "@/components/employees/permission-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function NouveauView() {
  return (
    <RequireAuth roles={["dg"]}>
      <NouvelEmployeContent />
    </RequireAuth>
  );
}

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  role: EmployeeRole;
};

const INITIAL_FORM: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  role: "agent",
};

const ROLE_LABELS: Record<EmployeeRole, string> = { agent: "Agent", comptable: "Comptable" };

type CreatedEmployee = {
  name: string;
  identifier: string;
  temporaryPassword: string;
  role: EmployeeRole;
  phone: string;
  email: string | null;
};

function NouvelEmployeContent() {
  const { accessToken } = useAuth();
  const online = useOnlineStatus();
  const [catalog, setCatalog] = React.useState<PermissionCatalogEntry[]>([]);
  const [defaults, setDefaults] = React.useState<Record<string, PermissionKey[]>>({});
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [permissions, setPermissions] = React.useState<PermissionKey[]>([]);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatedEmployee | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    fetchPermissionCatalog(accessToken).then((res) => {
      setCatalog(res.permissions);
      setDefaults(res.defaultsByRole);
      setPermissions(res.defaultsByRole.agent ?? []);
    });
  }, [accessToken]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleRoleChange(role: EmployeeRole) {
    set("role", role);
    setPermissions(defaults[role] ?? []);
  }

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) e.firstName = "Prénom requis";
    if (!form.lastName.trim()) e.lastName = "Nom requis";
    if (!form.phone) e.phone = "Numéro requis";
    else if (!normalizeBeninPhone(form.phone)) e.phone = "Numéro béninois invalide (ex. 0161234567)";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email invalide";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ firstName: true, lastName: true, phone: true, email: true });
    if (!isValid || !accessToken) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const res = await createEmployee(accessToken, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        role: form.role,
        permissions,
      });
      setResult({
        name: `${res.employee.firstName} ${res.employee.lastName}`,
        identifier: res.employee.identifier,
        temporaryPassword: res.temporaryPassword,
        role: res.employee.role,
        phone: res.employee.phone,
        email: res.employee.email,
      });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href="/espace/employes"
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour aux employés
        </Link>

        {result ? (
          <SuccessPanel employee={result} />
        ) : (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Nouvel employé</CardTitle>
              <CardDescription>
                Un identifiant de connexion et un mot de passe temporaire sont générés
                automatiquement. L&apos;employé devra le changer dès sa première connexion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                {!online && <OfflineNotice action="la création d'un employé" />}
                {serverError && (
                  <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                    {serverError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Prénom"
                    htmlFor="firstName"
                    required
                    error={touched.firstName ? errors.firstName : undefined}
                  >
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => set("firstName", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
                    />
                  </Field>
                  <Field
                    label="Nom"
                    htmlFor="lastName"
                    required
                    error={touched.lastName ? errors.lastName : undefined}
                  >
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => set("lastName", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Numéro de contact (WhatsApp)"
                    htmlFor="phone"
                    required
                    hint="Ex. 0161234567 — sert à lui envoyer ses identifiants"
                    error={touched.phone ? errors.phone : undefined}
                  >
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                      inputMode="tel"
                    />
                  </Field>
                  <Field
                    label="Email (optionnel)"
                    htmlFor="email"
                    error={touched.email ? errors.email : undefined}
                  >
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    />
                  </Field>
                </div>

                <Field label="Poste" htmlFor="role" required>
                  <div className="flex gap-2">
                    {(["agent", "comptable"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRoleChange(r)}
                        className={`flex-1 rounded-lg border px-3 py-2 font-label-md transition-colors ${
                          form.role === r
                            ? "border-primary bg-surface-muted text-ink"
                            : "border-border text-ink-soft hover:bg-surface-hover"
                        }`}
                      >
                        {ROLE_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="flex flex-col gap-2">
                  <span className="font-label-sm text-ink-soft">Accès autorisés</span>
                  <PermissionPicker catalog={catalog} value={permissions} onChange={setPermissions} />
                </div>

                <Button type="submit" size="lg" disabled={submitting || !online}>
                  {submitting ? "Création en cours…" : !online ? "Indisponible hors-ligne" : "Créer l'employé"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function buildCredentialsMessage(employee: CreatedEmployee) {
  return [
    `Bonjour ${employee.name},`,
    `Voici vos identifiants Lyko System :`,
    `Identifiant : ${employee.identifier}`,
    `Mot de passe temporaire : ${employee.temporaryPassword}`,
    `Poste : ${ROLE_LABELS[employee.role]}`,
    `Connectez-vous sur l'onglet « Employé » puis changez votre mot de passe dès la première connexion.`,
  ].join("\n");
}

function SuccessPanel({ employee }: { employee: CreatedEmployee }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(employee.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé, permissions) : ignoré silencieusement,
      // le mot de passe reste visible à l'écran pour une copie manuelle.
    }
  }

  const message = buildCredentialsMessage(employee);
  const whatsappHref = `https://wa.me/${toE164Benin(employee.phone).replace("+", "")}?text=${encodeURIComponent(message)}`;
  const mailHref = employee.email
    ? `mailto:${employee.email}?subject=${encodeURIComponent("Vos identifiants Lyko System")}&body=${encodeURIComponent(message)}`
    : null;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <Badge variant="success" className="mb-2 w-fit">
          Compte créé
        </Badge>
        <CardTitle>{employee.name} peut maintenant se connecter</CardTitle>
        <CardDescription>
          Envoyez-lui ces informations. L&apos;identifiant et le mot de passe temporaire ne
          seront plus affichés ensuite ; il devra changer son mot de passe dès sa première
          connexion.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
            <p className="font-label-sm uppercase tracking-wider text-ink-muted">Identifiant</p>
            <code className="font-currency-table text-headline-sm tracking-wide text-ink">
              {employee.identifier}
            </code>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
            <div>
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Mot de passe</p>
              <code className="font-currency-table text-headline-sm tracking-wide text-ink">
                {employee.temporaryPassword}
              </code>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copié" : "Copier"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "whatsapp", className: "flex-1" })}
          >
            <MessageCircle size={18} />
            Envoyer par WhatsApp
          </a>
          {mailHref ? (
            <a href={mailHref} className={buttonVariants({ variant: "secondary", className: "flex-1" })}>
              <Mail size={18} />
              Envoyer par email
            </a>
          ) : (
            <span className="flex flex-1 items-center justify-center gap-2 rounded border border-border px-4 py-2 font-label-md text-ink-faint">
              <Mail size={18} />
              Aucun email renseigné
            </span>
          )}
        </div>

        <Link href="/espace/employes" className={buttonVariants({ variant: "ghost" })}>
          Retour à la liste des employés
        </Link>
      </CardContent>
    </Card>
  );
}
