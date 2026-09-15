"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createOwner } from "@/lib/api/owners";
import { normalizeBeninPhone } from "@/lib/validation/auth";
import { RequireAuth } from "@/components/auth/require-auth";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

type FormState = { name: string; phone: string; email: string; address: string };
const INITIAL: FormState = { name: "", phone: "", email: "", address: "" };

export function NouveauView() {
  return (
    <RequireAuth permission="proprietaires">
      <NouveauContent />
    </RequireAuth>
  );
}

function NouveauContent() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const online = useOnlineStatus();
  const toast = useToast();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = "Nom requis";
    if (form.phone && !normalizeBeninPhone(form.phone)) e.phone = "Numéro béninois invalide";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email invalide";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true });
    if (!isValid || !accessToken) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const res = await createOwner(accessToken, {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      toast.success(`Propriétaire ${form.name.trim()} créé.`);
      router.push(`/espace/proprietaires/${res.ownerId}`);
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
          href="/espace/proprietaires"
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour aux propriétaires
        </Link>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Nouveau propriétaire</CardTitle>
            <CardDescription>
              Vous pourrez ensuite lui rattacher un ou plusieurs biens depuis « Nos biens ».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {!online && <OfflineNotice action="la création d'un propriétaire" />}
              {serverError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {serverError}
                </div>
              )}

              <Field label="Nom" htmlFor="name" required error={touched.name ? errors.name : undefined}>
                <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Téléphone (optionnel)" htmlFor="phone" hint="Ex. 0197001122" error={touched.phone ? errors.phone : undefined}>
                  <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, phone: true }))} inputMode="tel" />
                </Field>
                <Field label="Email (optionnel)" htmlFor="email" error={touched.email ? errors.email : undefined}>
                  <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
                </Field>
              </div>
              <Field label="Adresse (optionnel)" htmlFor="address">
                <Input id="address" value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>

              <Button type="submit" size="lg" disabled={submitting || !online}>
                {submitting ? "Création en cours…" : !online ? "Indisponible hors-ligne" : "Créer le propriétaire"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
