"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createRenter, type PaymentMethod } from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { normalizeBeninPhone, buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { PropertyUnitPicker } from "@/components/properties/property-unit-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Field, Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  profession: string;
  monthlyRent: string;
  depositAmount: string;
  depositPaymentMethod: string;
  depositPaidAt: string;
  entryFeeAmount: string;
  entryFeePaymentMethod: string;
  entryFeePaidAt: string;
  rentDueDay: string;
  startDate: string;
  openingDebtAmount: string;
  upToDateAtOnboarding: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const INITIAL: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  profession: "",
  monthlyRent: "",
  depositAmount: "",
  depositPaymentMethod: "",
  depositPaidAt: todayIso(),
  entryFeeAmount: "",
  entryFeePaymentMethod: "",
  entryFeePaidAt: todayIso(),
  rentDueDay: "5",
  startDate: todayIso(),
  openingDebtAmount: "",
  upToDateAtOnboarding: false,
};

const DEPOSIT_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

export function NouveauView() {
  return (
    <RequireAuth permission="locataires">
      <NouveauContent />
    </RequireAuth>
  );
}

type CreatedRenter = {
  renterId: number;
  firstName: string;
  phone: string;
  portalUrl: string;
};

function NouveauContent() {
  const { accessToken } = useAuth();
  const online = useOnlineStatus();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatedRenter | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSelectUnit(unit: Unit) {
    setSelectedUnit(unit);
    if (!form.monthlyRent) set("monthlyRent", String(unit.monthlyRent));
  }

  // Date d'entrée antérieure au mois en cours : onboarding d'un locataire
  // déjà en place, pas une vraie nouvelle entrée — la question "à jour ?"
  // n'a de sens que dans ce cas (voir services/rentTracking.js `computeArrears`).
  const isHistoricalStartDate = form.startDate.slice(0, 7) < todayIso().slice(0, 7);

  const errors = React.useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) e.firstName = "Prénom requis";
    if (!form.lastName.trim()) e.lastName = "Nom requis";
    if (!form.phone) e.phone = "Numéro requis";
    else if (!normalizeBeninPhone(form.phone)) e.phone = "Numéro béninois invalide (ex. 0161234567)";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email invalide";
    const rent = Number(form.monthlyRent);
    if (!form.monthlyRent || !Number.isFinite(rent) || rent <= 0) e.monthlyRent = "Loyer invalide";
    const deposit = Number(form.depositAmount || "0");
    if (!Number.isFinite(deposit) || deposit < 0) e.depositAmount = "Montant invalide";
    if (deposit > 0 && !form.depositPaymentMethod) e.depositPaymentMethod = "Comment la caution a-t-elle été reçue ?";
    const entryFee = Number(form.entryFeeAmount || "0");
    if (!Number.isFinite(entryFee) || entryFee < 0) e.entryFeeAmount = "Montant invalide";
    if (entryFee > 0 && !form.entryFeePaymentMethod) e.entryFeePaymentMethod = "Comment les frais d'agence ont-ils été reçus ?";
    const day = Number(form.rentDueDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) e.rentDueDay = "Jour entre 1 et 28";
    if (!form.startDate) e.startDate = "Date requise";
    const openingDebt = Number(form.openingDebtAmount || "0");
    if (!Number.isFinite(openingDebt) || openingDebt < 0) e.openingDebtAmount = "Montant invalide";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0 && !!selectedUnit;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      firstName: true, lastName: true, phone: true, email: true,
      monthlyRent: true, depositAmount: true, depositPaymentMethod: true, rentDueDay: true, startDate: true,
      openingDebtAmount: true, entryFeeAmount: true, entryFeePaymentMethod: true,
    });
    if (!isValid || !accessToken || !selectedUnit) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const res = await createRenter(accessToken, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        profession: form.profession.trim() || undefined,
        unitId: selectedUnit.id,
        monthlyRent: Number(form.monthlyRent),
        depositAmount: Number(form.depositAmount || "0"),
        depositPaymentMethod:
          Number(form.depositAmount || "0") > 0
            ? (form.depositPaymentMethod as Exclude<PaymentMethod, "kkiapay">)
            : undefined,
        depositPaidAt: Number(form.depositAmount || "0") > 0 ? form.depositPaidAt : undefined,
        entryFeeAmount: Number(form.entryFeeAmount || "0"),
        entryFeePaymentMethod:
          Number(form.entryFeeAmount || "0") > 0
            ? (form.entryFeePaymentMethod as Exclude<PaymentMethod, "kkiapay">)
            : undefined,
        entryFeePaidAt: Number(form.entryFeeAmount || "0") > 0 ? form.entryFeePaidAt : undefined,
        rentDueDay: Number(form.rentDueDay),
        startDate: form.startDate,
        openingDebtAmount: Number(form.openingDebtAmount || "0"),
        upToDateAtOnboarding: isHistoricalStartDate ? form.upToDateAtOnboarding : undefined,
      });
      setResult({
        renterId: res.renterId,
        firstName: form.firstName.trim(),
        phone: form.phone.trim(),
        portalUrl: `${window.location.origin}${res.portalLink.path}`,
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
          href="/espace/locataires"
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour aux locataires
        </Link>

        {result ? (
          <PortalLinkSuccessPanel renter={result} />
        ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Nouveau locataire</CardTitle>
            <CardDescription>
              Sélectionnez d&apos;abord une unité libre, puis renseignez le locataire et les
              termes du bail. L&apos;état des lieux d&apos;entrée pourra être réalisé juste après.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
              {!online && <OfflineNotice action="la création d'un locataire" />}
              {serverError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {serverError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">
                  Bien &amp; unité louée
                </span>
                <PropertyUnitPicker accessToken={accessToken} selectedUnit={selectedUnit} onSelect={handleSelectUnit} />
                {selectedUnit && (
                  <p className="text-body-xs text-success-fg">
                    Unité {selectedUnit.code} sélectionnée — {formatFcfa(selectedUnit.monthlyRent)}/mois.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-5">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Identité</span>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Prénom" htmlFor="firstName" required error={touched.firstName ? errors.firstName : undefined}>
                    <Input id="firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, firstName: true }))} />
                  </Field>
                  <Field label="Nom" htmlFor="lastName" required error={touched.lastName ? errors.lastName : undefined}>
                    <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, lastName: true }))} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Numéro de téléphone" htmlFor="phone" required hint="Ex. 0161234567" error={touched.phone ? errors.phone : undefined}>
                    <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, phone: true }))} inputMode="tel" />
                  </Field>
                  <Field label="Email (optionnel)" htmlFor="email" error={touched.email ? errors.email : undefined}>
                    <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
                  </Field>
                </div>
                <Field label="Profession (optionnel)" htmlFor="profession">
                  <Input id="profession" value={form.profession} onChange={(e) => set("profession", e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-5">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Bail</span>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Loyer mensuel (FCFA)" htmlFor="monthlyRent" required hint="Pré-rempli depuis l'unité, modifiable" error={touched.monthlyRent ? errors.monthlyRent : undefined}>
                    <Input id="monthlyRent" inputMode="numeric" value={form.monthlyRent} onChange={(e) => set("monthlyRent", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, monthlyRent: true }))} />
                  </Field>
                  <Field label="Caution (FCFA)" htmlFor="depositAmount" hint="0 si aucune" error={touched.depositAmount ? errors.depositAmount : undefined}>
                    <Input id="depositAmount" inputMode="numeric" value={form.depositAmount} onChange={(e) => set("depositAmount", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, depositAmount: true }))} />
                  </Field>
                </div>
                {Number(form.depositAmount || "0") > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Caution reçue par"
                      htmlFor="depositPaymentMethod"
                      required
                      error={touched.depositPaymentMethod ? errors.depositPaymentMethod : undefined}
                    >
                      <select
                        id="depositPaymentMethod"
                        value={form.depositPaymentMethod}
                        onChange={(e) => set("depositPaymentMethod", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, depositPaymentMethod: true }))}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="" disabled>
                          Choisir…
                        </option>
                        {DEPOSIT_PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reçue le" htmlFor="depositPaidAt">
                      <Input
                        id="depositPaidAt"
                        type="date"
                        value={form.depositPaidAt}
                        onChange={(e) => set("depositPaidAt", e.target.value)}
                      />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Frais d'agence à l'entrée (FCFA)"
                    htmlFor="entryFeeAmount"
                    hint="Pris directement au locataire, jamais reversé au propriétaire — 0 si aucun"
                    error={touched.entryFeeAmount ? errors.entryFeeAmount : undefined}
                  >
                    <Input
                      id="entryFeeAmount"
                      inputMode="numeric"
                      value={form.entryFeeAmount}
                      onChange={(e) => set("entryFeeAmount", e.target.value.replace(/\D/g, ""))}
                      onBlur={() => setTouched((t) => ({ ...t, entryFeeAmount: true }))}
                    />
                  </Field>
                </div>
                {Number(form.entryFeeAmount || "0") > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Frais d'agence reçus par"
                      htmlFor="entryFeePaymentMethod"
                      required
                      error={touched.entryFeePaymentMethod ? errors.entryFeePaymentMethod : undefined}
                    >
                      <select
                        id="entryFeePaymentMethod"
                        value={form.entryFeePaymentMethod}
                        onChange={(e) => set("entryFeePaymentMethod", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, entryFeePaymentMethod: true }))}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="" disabled>
                          Choisir…
                        </option>
                        {DEPOSIT_PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reçus le" htmlFor="entryFeePaidAt">
                      <Input
                        id="entryFeePaidAt"
                        type="date"
                        value={form.entryFeePaidAt}
                        onChange={(e) => set("entryFeePaidAt", e.target.value)}
                      />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Jour d'échéance du loyer" htmlFor="rentDueDay" required hint="1 à 28" error={touched.rentDueDay ? errors.rentDueDay : undefined}>
                    <Input id="rentDueDay" inputMode="numeric" value={form.rentDueDay} onChange={(e) => set("rentDueDay", e.target.value.replace(/\D/g, ""))} onBlur={() => setTouched((t) => ({ ...t, rentDueDay: true }))} />
                  </Field>
                  <Field label="Date d'entrée" htmlFor="startDate" required error={touched.startDate ? errors.startDate : undefined}>
                    <Input id="startDate" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, startDate: true }))} />
                  </Field>
                </div>
                <Field
                  label="Impayés existants à l'entrée (FCFA)"
                  htmlFor="openingDebtAmount"
                  hint="Locataire déjà en place avant Lyko System, avec un impayé connu — 0 si aucun"
                  error={touched.openingDebtAmount ? errors.openingDebtAmount : undefined}
                >
                  <Input
                    id="openingDebtAmount"
                    inputMode="numeric"
                    value={form.openingDebtAmount}
                    onChange={(e) => set("openingDebtAmount", e.target.value.replace(/\D/g, ""))}
                    onBlur={() => setTouched((t) => ({ ...t, openingDebtAmount: true }))}
                  />
                </Field>
                {isHistoricalStartDate && (
                  <label
                    htmlFor="upToDateAtOnboarding"
                    className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink"
                  >
                    <input
                      id="upToDateAtOnboarding"
                      type="checkbox"
                      checked={form.upToDateAtOnboarding}
                      onChange={(e) => set("upToDateAtOnboarding", e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Ce locataire est à jour sur son loyer, y compris le mois en cours — évite un faux retard si
                      l&apos;échéance de ce mois est déjà passée. (Les mois antérieurs à aujourd&apos;hui ne sont de
                      toute façon jamais comptés, même sans cocher cette case.)
                    </span>
                  </label>
                )}
              </div>

              <Button type="submit" size="lg" disabled={submitting || !selectedUnit || !online}>
                {submitting
                  ? "Création en cours…"
                  : !online
                    ? "Indisponible hors-ligne"
                    : !selectedUnit
                      ? "Sélectionnez une unité"
                      : "Créer le locataire"}
              </Button>
            </form>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Affiché juste après la création : le lien du portail locataire vient
 * d'être généré automatiquement (étape 13, idée n°2) et n'est montré qu'une
 * seule fois ici — même schéma que le mot de passe temporaire d'un nouvel
 * employé (`app/espace/employes/nouveau`). Si perdu, on repasse par
 * « Régénérer le lien » sur la fiche du locataire.
 */
function PortalLinkSuccessPanel({ renter }: { renter: CreatedRenter }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(renter.portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le lien reste visible pour une copie manuelle.
    }
  }

  const message = [
    `Bonjour ${renter.firstName},`,
    `Bienvenue ! Voici votre espace personnel pour suivre vos paiements de loyer, télécharger vos quittances et signaler un problème :`,
    renter.portalUrl,
    `Ce lien est personnel, ne le partagez pas.`,
  ].join("\n");
  const whatsappHref = buildWhatsAppHref(renter.phone, message);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <Badge variant="success" className="mb-2 w-fit">
          Locataire créé
        </Badge>
        <CardTitle>{renter.firstName} peut déjà suivre ses paiements</CardTitle>
        <CardDescription>
          Un lien personnel, sans mot de passe, a été généré automatiquement — il donne accès aux paiements,
          quittances, attestation de loyer et au signalement d&apos;incidents de ce locataire uniquement. Il ne sera
          plus affiché ensuite (une régénération reste possible depuis sa fiche).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
          <code className="truncate text-body-sm text-ink">{renter.portalUrl}</code>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copié" : "Copier"}
          </Button>
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
          <Link
            href={`/espace/locataires/${renter.renterId}`}
            className={buttonVariants({ variant: "secondary", className: "flex-1" })}
          >
            Voir la fiche du locataire
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
