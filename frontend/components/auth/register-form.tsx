"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { normalizeBeninPhone, RCCM_RE, IFU_RE, PASSWORD_RE, passwordStrength } from "@/lib/validation/auth";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type FormState = {
  firstName: string;
  lastName: string;
  companyName: string;
  rccm: string;
  ifu: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

const INITIAL_FORM: FormState = {
  firstName: "",
  lastName: "",
  companyName: "",
  rccm: "",
  ifu: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

function strengthColor(score: number) {
  if (score <= 2) return "bg-danger";
  if (score <= 3) return "bg-warning";
  return "bg-success";
}

/** Formulaire d'inscription de l'entreprise (section 4.2) — validation en temps réel. */
export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();

  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [logo, setLogo] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function markTouched(key: keyof FormState) {
    setTouched((t) => ({ ...t, [key]: true }));
  }

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) e.firstName = "Prénom requis";
    if (!form.lastName.trim()) e.lastName = "Nom requis";
    if (!form.companyName.trim()) e.companyName = "Nom de l'entreprise requis";

    if (!form.rccm) e.rccm = "RCCM requis";
    else if (!RCCM_RE.test(form.rccm.toUpperCase())) e.rccm = "Format invalide (ex. RB/COT/21 B 1234)";

    if (!form.ifu) e.ifu = "IFU requis";
    else if (!IFU_RE.test(form.ifu)) e.ifu = "IFU invalide (13 chiffres)";

    if (!form.phone) e.phone = "Numéro requis";
    else if (!normalizeBeninPhone(form.phone)) e.phone = "Numéro béninois invalide (ex. 0161234567)";

    if (!form.password) e.password = "Mot de passe requis";
    else if (!PASSWORD_RE.test(form.password))
      e.password = "10 caractères min., majuscule, minuscule, chiffre, caractère spécial";

    if (!form.confirmPassword) e.confirmPassword = "Confirmation requise";
    else if (form.confirmPassword !== form.password) e.confirmPassword = "Les mots de passe ne correspondent pas";

    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;
  const strength = passwordStrength(form.password);
  const passwordsMatch = form.confirmPassword.length > 0 && form.confirmPassword === form.password;

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogo(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      firstName: true,
      lastName: true,
      companyName: true,
      rccm: true,
      ifu: true,
      phone: true,
      password: true,
      confirmPassword: true,
    });
    if (!isValid) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const fd = new FormData();
      fd.append("firstName", form.firstName.trim());
      fd.append("lastName", form.lastName.trim());
      fd.append("companyName", form.companyName.trim());
      fd.append("rccm", form.rccm.trim().toUpperCase());
      fd.append("ifu", form.ifu.trim());
      fd.append("phone", form.phone.trim());
      fd.append("password", form.password);
      fd.append("confirmPassword", form.confirmPassword);
      if (logo) fd.append("logo", logo);

      await register(fd);
      router.push("/espace");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {serverError && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
          {serverError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Prénom" htmlFor="firstName" required error={touched.firstName ? errors.firstName : undefined}>
          <Input
            id="firstName"
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            onBlur={() => markTouched("firstName")}
            autoComplete="given-name"
          />
        </Field>
        <Field label="Nom" htmlFor="lastName" required error={touched.lastName ? errors.lastName : undefined}>
          <Input
            id="lastName"
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            onBlur={() => markTouched("lastName")}
            autoComplete="family-name"
          />
        </Field>
      </div>

      <Field
        label="Nom de l'entreprise"
        htmlFor="companyName"
        required
        error={touched.companyName ? errors.companyName : undefined}
      >
        <Input
          id="companyName"
          value={form.companyName}
          onChange={(e) => set("companyName", e.target.value)}
          onBlur={() => markTouched("companyName")}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="RCCM"
          htmlFor="rccm"
          required
          hint="Ex. RB/COT/21 B 1234"
          error={touched.rccm ? errors.rccm : undefined}
        >
          <Input
            id="rccm"
            value={form.rccm}
            onChange={(e) => set("rccm", e.target.value)}
            onBlur={() => markTouched("rccm")}
          />
        </Field>
        <Field label="IFU" htmlFor="ifu" required hint="13 chiffres" error={touched.ifu ? errors.ifu : undefined}>
          <Input
            id="ifu"
            value={form.ifu}
            onChange={(e) => set("ifu", e.target.value.replace(/\D/g, ""))}
            onBlur={() => markTouched("ifu")}
            inputMode="numeric"
            maxLength={13}
          />
        </Field>
      </div>

      <Field
        label="Numéro à contacter"
        htmlFor="phone"
        required
        hint="Ex. 0161234567"
        error={touched.phone ? errors.phone : undefined}
      >
        <Input
          id="phone"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          onBlur={() => markTouched("phone")}
          inputMode="tel"
          autoComplete="tel"
        />
      </Field>

      <Field
        label="Logo de l'entreprise (optionnel)"
        htmlFor="logo"
        hint="PNG, JPEG ou WEBP, 2 Mo max. Ajoutable plus tard dans les paramètres."
      >
        <div className="flex items-center gap-3">
          {logoPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoPreview}
              alt="Aperçu du logo"
              className="h-12 w-12 rounded-lg border border-border bg-surface object-contain"
            />
          )}
          <input
            id="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleLogoChange}
            className="text-body-sm text-ink-soft file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:font-label-sm file:text-ink"
          />
        </div>
      </Field>

      <div className="flex flex-col gap-1.5">
        <Field
          label="Mot de passe"
          htmlFor="password"
          required
          hint="10 caractères min., majuscule, minuscule, chiffre, caractère spécial"
          error={touched.password ? errors.password : undefined}
        >
          <Input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            onBlur={() => markTouched("password")}
            autoComplete="new-password"
          />
        </Field>
        {form.password.length > 0 && (
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
        <Field
          label="Confirmation du mot de passe"
          htmlFor="confirmPassword"
          required
          error={touched.confirmPassword ? errors.confirmPassword : undefined}
        >
          <Input
            id="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={(e) => set("confirmPassword", e.target.value)}
            onBlur={() => markTouched("confirmPassword")}
            autoComplete="new-password"
          />
        </Field>
        {form.confirmPassword.length > 0 && (
          <p className={`text-body-xs ${passwordsMatch ? "text-success-fg" : "text-danger-fg"}`}>
            {passwordsMatch ? "Les mots de passe correspondent ✓" : "Les mots de passe ne correspondent pas"}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Création en cours…" : "Créer mon compte"}
      </Button>
    </form>
  );
}
