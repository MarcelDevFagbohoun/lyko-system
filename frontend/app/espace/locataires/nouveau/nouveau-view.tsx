"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createRenter, RENT_TIMING_LABELS, type PaymentMethod, type RentTiming, type AdditionalDepositType, type AdditionalDeposit } from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { normalizeBeninPhone, buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa, previewEntryProrata } from "@/lib/utils";
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
  entryProration: "aucun" | "prorata";
  entryProrataPaymentMethod: string;
  entryProrataPaidAt: string;
  additionalDeposits: Record<AdditionalDepositType, { amount: string; paymentMethod: string; paidAt: string }>;
  rentDueDay: string;
  rentTiming: RentTiming;
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
  entryProration: "aucun",
  entryProrataPaymentMethod: "",
  entryProrataPaidAt: todayIso(),
  additionalDeposits: {
    sbee: { amount: "", paymentMethod: "", paidAt: todayIso() },
    soneb: { amount: "", paymentMethod: "", paidAt: todayIso() },
    peinture: { amount: "", paymentMethod: "", paidAt: todayIso() },
  },
  rentDueDay: "5",
  rentTiming: "avance",
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

// Cautions supplémentaires (étape 43) — même catalogue que constants/leaseDeposits.js (backend).
const ADDITIONAL_DEPOSIT_TYPES: {
  key: AdditionalDepositType;
  label: string;
  enabledKey: "depositSbeeEnabled" | "depositSonebEnabled" | "depositPeintureEnabled";
}[] = [
  { key: "sbee", label: "Caution SBEE (électricité)", enabledKey: "depositSbeeEnabled" },
  { key: "soneb", label: "Caution SONEB (eau)", enabledKey: "depositSonebEnabled" },
  { key: "peinture", label: "Caution peinture", enabledKey: "depositPeintureEnabled" },
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
  entryProrata: { proration: "aucun" | "prorata"; amount: number; days: number; dueDate: string };
  additionalDeposits: AdditionalDeposit[];
};

function NouveauContent() {
  const { accessToken, tenant } = useAuth();
  const online = useOnlineStatus();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [touched, setTouched] = React.useState<Partial<Record<keyof FormState, boolean>>>({});
  const [additionalDepositsTouched, setAdditionalDepositsTouched] = React.useState<Partial<Record<AdditionalDepositType, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatedRenter | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setAdditionalDeposit(type: AdditionalDepositType, patch: Partial<{ amount: string; paymentMethod: string; paidAt: string }>) {
    setForm((f) => ({
      ...f,
      additionalDeposits: { ...f.additionalDeposits, [type]: { ...f.additionalDeposits[type], ...patch } },
    }));
  }

  const enabledAdditionalDepositTypes = ADDITIONAL_DEPOSIT_TYPES.filter((t) => tenant?.[t.enabledKey]);

  // Pré-remplit depuis le réglage par défaut de l'entreprise (Paramètres) —
  // uniquement si l'agent n'a pas encore touché ce champ lui-même.
  React.useEffect(() => {
    if (tenant?.defaultRentTiming && !touched.rentTiming) {
      set("rentTiming", tenant.defaultRentTiming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.defaultRentTiming]);

  React.useEffect(() => {
    if (tenant?.defaultEntryProration && !touched.entryProration) {
      set("entryProration", tenant.defaultEntryProration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.defaultEntryProration]);

  function handleSelectUnit(unit: Unit) {
    setSelectedUnit(unit);
    if (!form.monthlyRent) set("monthlyRent", String(unit.monthlyRent));
  }

  // Date d'entrée antérieure au mois en cours : onboarding d'un locataire
  // déjà en place, pas une vraie nouvelle entrée — la question "à jour ?"
  // n'a de sens que dans ce cas (voir services/rentTracking.js `computeArrears`).
  const isHistoricalStartDate = form.startDate.slice(0, 7) < todayIso().slice(0, 7);

  // Aperçu du prorata d'entrée (étape 42) — miroir exact du calcul serveur (`previewEntryProrata`,
  // lib/utils.ts) ; le montant réellement enregistré reste toujours recalculé par le serveur.
  const prorataPreview = React.useMemo(
    () => previewEntryProrata({ startDate: form.startDate, monthlyRent: Number(form.monthlyRent || "0"), rentDueDay: Number(form.rentDueDay || "5") }),
    [form.startDate, form.monthlyRent, form.rentDueDay],
  );

  // Un bail qui démarre APRÈS l'échéance de ce mois-ci facturerait, sans cette case, tout le mois en
  // retard dès sa création (l'échéance habituelle est déjà derrière la date d'entrée) — coché
  // automatiquement dans ce cas précis, jamais pour l'onboarding d'un locataire historique (case déjà
  // existante juste en dessous, décision volontaire de l'agent dans ce cas-là).
  React.useEffect(() => {
    if (!isHistoricalStartDate && prorataPreview.days > 0 && !touched.upToDateAtOnboarding) {
      set("upToDateAtOnboarding", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prorataPreview.days, isHistoricalStartDate]);

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
    if (form.entryProration === "prorata" && prorataPreview.amount > 0 && !form.entryProrataPaymentMethod) {
      e.entryProrataPaymentMethod = "Comment le prorata d'entrée a-t-il été reçu ?";
    }
    const day = Number(form.rentDueDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) e.rentDueDay = "Jour entre 1 et 28";
    if (!form.startDate) e.startDate = "Date requise";
    const openingDebt = Number(form.openingDebtAmount || "0");
    if (!Number.isFinite(openingDebt) || openingDebt < 0) e.openingDebtAmount = "Montant invalide";
    return e;
  }, [form, prorataPreview.amount]);

  // Cautions supplémentaires (étape 43) — même principe que la caution de loyer/les frais d'agence
  // ci-dessus : mode de règlement requis seulement si un montant est saisi.
  const additionalDepositErrors = React.useMemo(() => {
    const e: Partial<Record<AdditionalDepositType, string>> = {};
    for (const t of enabledAdditionalDepositTypes) {
      const entry = form.additionalDeposits[t.key];
      const amount = Number(entry.amount || "0");
      if (!Number.isFinite(amount) || amount < 0) e[t.key] = "Montant invalide";
      else if (amount > 0 && !entry.paymentMethod) e[t.key] = "Comment cette caution a-t-elle été reçue ?";
    }
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.additionalDeposits, enabledAdditionalDepositTypes.length]);

  const isValid = Object.keys(errors).length === 0 && Object.keys(additionalDepositErrors).length === 0 && !!selectedUnit;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      firstName: true, lastName: true, phone: true, email: true,
      monthlyRent: true, depositAmount: true, depositPaymentMethod: true, rentDueDay: true, startDate: true,
      openingDebtAmount: true, entryFeeAmount: true, entryFeePaymentMethod: true, entryProrataPaymentMethod: true,
    });
    setAdditionalDepositsTouched(Object.fromEntries(enabledAdditionalDepositTypes.map((t) => [t.key, true])));
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
        entryProration: form.entryProration,
        entryProrataPaymentMethod:
          form.entryProration === "prorata" && prorataPreview.amount > 0
            ? (form.entryProrataPaymentMethod as Exclude<PaymentMethod, "kkiapay">)
            : undefined,
        entryProrataPaidAt: form.entryProration === "prorata" && prorataPreview.amount > 0 ? form.entryProrataPaidAt : undefined,
        additionalDeposits: Object.fromEntries(
          enabledAdditionalDepositTypes
            .filter((t) => Number(form.additionalDeposits[t.key].amount || "0") > 0)
            .map((t) => {
              const entry = form.additionalDeposits[t.key];
              return [
                t.key,
                {
                  amount: Number(entry.amount),
                  paymentMethod: entry.paymentMethod as Exclude<PaymentMethod, "kkiapay">,
                  paidAt: entry.paidAt,
                },
              ];
            }),
        ),
        rentDueDay: Number(form.rentDueDay),
        rentTiming: form.rentTiming,
        startDate: form.startDate,
        openingDebtAmount: Number(form.openingDebtAmount || "0"),
        // Toujours transmis (plus seulement pour l'onboarding historique) : l'auto-suggestion ci-dessus
        // peut l'avoir coché pour un bail qui démarre après l'échéance du mois — jamais perdu à l'envoi.
        upToDateAtOnboarding: form.upToDateAtOnboarding,
      });
      setResult({
        renterId: res.renterId,
        firstName: form.firstName.trim(),
        phone: form.phone.trim(),
        portalUrl: `${window.location.origin}${res.portalLink.path}`,
        entryProrata: res.entryProrata,
        additionalDeposits: res.additionalDeposits,
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

                {prorataPreview.days > 0 && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
                    <p className="text-body-sm text-ink">
                      Entrée le <strong>{form.startDate.split("-").reverse().join("/")}</strong>, échéance habituelle le{" "}
                      {form.rentDueDay} — {prorataPreview.days} jour{prorataPreview.days > 1 ? "s" : ""} avant le premier cycle
                      normal ({prorataPreview.dueDate.split("-").reverse().join("/")}).
                    </p>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-start gap-2.5 text-body-sm text-ink">
                        <input
                          type="radio"
                          name="entryProration"
                          checked={form.entryProration === "aucun"}
                          onChange={() => {
                            set("entryProration", "aucun");
                            setTouched((t) => ({ ...t, entryProration: true }));
                          }}
                          className="mt-0.5"
                        />
                        <span>Ne rien facturer pour ces jours (le premier loyer plein sera dû à la prochaine échéance).</span>
                      </label>
                      <label className="flex items-start gap-2.5 text-body-sm text-ink">
                        <input
                          type="radio"
                          name="entryProration"
                          checked={form.entryProration === "prorata"}
                          onChange={() => {
                            set("entryProration", "prorata");
                            setTouched((t) => ({ ...t, entryProration: true }));
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          Facturer le prorata d&apos;entrée : <strong>{formatFcfa(prorataPreview.amount)}</strong> pour{" "}
                          {prorataPreview.days} jour{prorataPreview.days > 1 ? "s" : ""} (loyer ÷ 30 × jours) — appartient au
                          propriétaire, ajouté à son compte séquestre.
                        </span>
                      </label>
                    </div>
                    {!isHistoricalStartDate && (
                      <label htmlFor="upToDateAtOnboarding" className="flex items-start gap-2.5 text-body-xs text-ink-muted">
                        <input
                          id="upToDateAtOnboarding"
                          type="checkbox"
                          checked={form.upToDateAtOnboarding}
                          onChange={(e) => {
                            set("upToDateAtOnboarding", e.target.checked);
                            setTouched((t) => ({ ...t, upToDateAtOnboarding: true }));
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          Faire démarrer le cycle de loyer normal à la prochaine échéance ({prorataPreview.dueDate.split("-").reverse().join("/")}
                          ) plutôt qu&apos;à celle de ce mois-ci, déjà passée à la date d&apos;entrée — coché par défaut, sinon le
                          bail apparaîtrait à tort en retard dès sa création.
                        </span>
                      </label>
                    )}
                    {form.entryProration === "prorata" && prorataPreview.amount > 0 && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field
                          label="Prorata reçu par"
                          htmlFor="entryProrataPaymentMethod"
                          required
                          error={touched.entryProrataPaymentMethod ? errors.entryProrataPaymentMethod : undefined}
                        >
                          <select
                            id="entryProrataPaymentMethod"
                            value={form.entryProrataPaymentMethod}
                            onChange={(e) => set("entryProrataPaymentMethod", e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, entryProrataPaymentMethod: true }))}
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
                        <Field label="Reçu le" htmlFor="entryProrataPaidAt">
                          <Input
                            id="entryProrataPaidAt"
                            type="date"
                            value={form.entryProrataPaidAt}
                            onChange={(e) => set("entryProrataPaidAt", e.target.value)}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}

                {enabledAdditionalDepositTypes.length > 0 && (
                  <div className="flex flex-col gap-4 rounded-lg border border-border-subtle p-4">
                    <p className="font-label-md text-ink">Cautions supplémentaires</p>
                    {enabledAdditionalDepositTypes.map((t) => {
                      const entry = form.additionalDeposits[t.key];
                      const amountId = `additionalDeposit-${t.key}-amount`;
                      const methodId = `additionalDeposit-${t.key}-method`;
                      const paidAtId = `additionalDeposit-${t.key}-paidAt`;
                      return (
                        <div key={t.key} className="flex flex-col gap-3">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field
                              label={`${t.label} (FCFA)`}
                              htmlFor={amountId}
                              hint="0 si non demandée à ce locataire"
                              error={additionalDepositsTouched[t.key] ? additionalDepositErrors[t.key] : undefined}
                            >
                              <Input
                                id={amountId}
                                inputMode="numeric"
                                value={entry.amount}
                                onChange={(e) => setAdditionalDeposit(t.key, { amount: e.target.value.replace(/\D/g, "") })}
                                onBlur={() => setAdditionalDepositsTouched((tt) => ({ ...tt, [t.key]: true }))}
                              />
                            </Field>
                          </div>
                          {Number(entry.amount || "0") > 0 && (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <Field label="Reçue par" htmlFor={methodId} required>
                                <select
                                  id={methodId}
                                  value={entry.paymentMethod}
                                  onChange={(e) => setAdditionalDeposit(t.key, { paymentMethod: e.target.value })}
                                  onBlur={() => setAdditionalDepositsTouched((tt) => ({ ...tt, [t.key]: true }))}
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
                              <Field label="Reçue le" htmlFor={paidAtId}>
                                <Input
                                  id={paidAtId}
                                  type="date"
                                  value={entry.paidAt}
                                  onChange={(e) => setAdditionalDeposit(t.key, { paidAt: e.target.value })}
                                />
                              </Field>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Field
                  label="Convention de paiement"
                  htmlFor="rentTiming"
                  hint="Réglable par défaut dans Paramètres — à ajuster ici si ce propriétaire a sa propre habitude"
                >
                  <select
                    id="rentTiming"
                    value={form.rentTiming}
                    onChange={(e) => {
                      set("rentTiming", e.target.value as RentTiming);
                      setTouched((t) => ({ ...t, rentTiming: true }));
                    }}
                    className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {Object.entries(RENT_TIMING_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Field>
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
          quittances, contrat de bail et au signalement d&apos;incidents de ce locataire uniquement. Il ne sera
          plus affiché ensuite (une régénération reste possible depuis sa fiche).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {renter.entryProrata.proration === "prorata" && renter.entryProrata.amount > 0 && (
          <div className="rounded-lg border border-primary-border bg-primary-bg px-4 py-3 text-body-sm text-ink">
            Prorata d&apos;entrée de <strong>{formatFcfa(renter.entryProrata.amount)}</strong> ({renter.entryProrata.days} jour
            {renter.entryProrata.days > 1 ? "s" : ""}) ajouté au compte séquestre du propriétaire de ce Bien.
          </div>
        )}
        {renter.additionalDeposits.length > 0 && (
          <div className="rounded-lg border border-primary-border bg-primary-bg px-4 py-3 text-body-sm text-ink">
            Cautions supplémentaires enregistrées :{" "}
            {renter.additionalDeposits.map((d) => `${d.typeLabel} (${formatFcfa(d.amount)})`).join(", ")}.
          </div>
        )}
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
