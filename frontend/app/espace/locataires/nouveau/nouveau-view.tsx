"use client";



import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  createRenter,
  type PaymentMethod,
  type AdditionalDepositType,
} from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { normalizeBeninPhone } from "@/lib/validation/auth";
import { formatFcfa, previewEntryProrata } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { PropertyUnitPicker } from "@/components/properties/property-unit-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { useTenantRhythm } from "@/lib/hooks/use-tenant-rhythm";
import { buildRentDuePayload, validateRentDue } from "@/components/renters/rent-due-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { todayIso } from "@/lib/dates";
import { ADDITIONAL_DEPOSIT_TYPES, FormState, INITIAL } from "./sections/form-state";
import { IdentityFields } from "./sections/identity-fields";
import { LeaseTermsFields } from "./sections/lease-terms-fields";
import { ProrataBlock } from "./sections/prorata-block";
import { AdditionalDepositsBlock } from "./sections/additional-deposits-block";
import { BillingOptionsFields } from "./sections/billing-options-fields";
import { PortalLinkSuccessPanel } from "./sections/portal-link-success-panel";
import { CreatedRenter } from "./sections/types";

export function NouveauView() {
  return (
    <RequireAuth permission="locataires">
      <NouveauContent />
    </RequireAuth>
  );
}

function NouveauContent() {
  const { accessToken, tenant } = useAuth();
  const online = useOnlineStatus();
  // Rythme de période de l'entreprise (étape 2b) : décide du champ d'échéance (jour du mois ou jours
  // après le début de la période) et masque le prorata d'entrée, calendaire uniquement côté serveur.
  const { rhythm } = useTenantRhythm(accessToken);
  const isCalendaireRhythm = !rhythm || rhythm.mode === "calendaire";
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
  // Bail non-calendaire : jamais de prorata d'entrée (le serveur l'ignore), donc aucun aperçu ni
  // mode de paiement exigé pour lui.
  const prorataPreview = React.useMemo(
    () =>
      isCalendaireRhythm
        ? previewEntryProrata({ startDate: form.startDate, monthlyRent: Number(form.monthlyRent || "0"), rentDueDay: Number(form.rentDueDay || "5") })
        : { days: 0, amount: 0, dueDate: form.startDate },
    [isCalendaireRhythm, form.startDate, form.monthlyRent, form.rentDueDay],
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
    const rentDueError = validateRentDue(rhythm, form.rentDueDay);
    if (rentDueError) e.rentDueDay = rentDueError;
    if (!form.startDate) e.startDate = "Date requise";
    const openingDebt = Number(form.openingDebtAmount || "0");
    if (!Number.isFinite(openingDebt) || openingDebt < 0) e.openingDebtAmount = "Montant invalide";
    return e;
  }, [form, prorataPreview.amount, rhythm]);

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
            ? (form.depositPaymentMethod as PaymentMethod)
            : undefined,
        depositPaidAt: Number(form.depositAmount || "0") > 0 ? form.depositPaidAt : undefined,
        entryFeeAmount: Number(form.entryFeeAmount || "0"),
        entryFeePaymentMethod:
          Number(form.entryFeeAmount || "0") > 0
            ? (form.entryFeePaymentMethod as PaymentMethod)
            : undefined,
        entryFeePaidAt: Number(form.entryFeeAmount || "0") > 0 ? form.entryFeePaidAt : undefined,
        entryProration: form.entryProration,
        entryProrataPaymentMethod:
          form.entryProration === "prorata" && prorataPreview.amount > 0
            ? (form.entryProrataPaymentMethod as PaymentMethod)
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
                  paymentMethod: entry.paymentMethod as PaymentMethod,
                  paidAt: entry.paidAt,
                },
              ];
            }),
        ),
        ...buildRentDuePayload(rhythm, form.rentDueDay),
        rentTiming: form.rentTiming,
        startDate: form.startDate,
        openingDebtAmount: Number(form.openingDebtAmount || "0"),
        // Toujours transmis (plus seulement pour l'onboarding historique) : l'auto-suggestion ci-dessus
        // peut l'avoir coché pour un bail qui démarre après l'échéance du mois — jamais perdu à l'envoi.
        upToDateAtOnboarding: form.upToDateAtOnboarding,
      });
      setResult({
        renterId: res.renterId,
        leaseId: res.leaseId,
        firstName: form.firstName.trim(),
        phone: form.phone.trim(),
        portalUrl: `${window.location.origin}${res.portalLink.path}`,
        entryProrata: res.entryProrata,
        additionalDeposits: res.additionalDeposits,
        entryReceipt: res.entryReceipt,
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
          <PortalLinkSuccessPanel renter={result} accessToken={accessToken} />
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

              <IdentityFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} />

              <div className="flex flex-col gap-4 border-t border-border pt-5">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Bail</span>
                <LeaseTermsFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} rhythm={rhythm} />
                <ProrataBlock form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} isCalendaireRhythm={isCalendaireRhythm} isHistoricalStartDate={isHistoricalStartDate} prorataPreview={prorataPreview} />
                <AdditionalDepositsBlock form={form} enabledTypes={enabledAdditionalDepositTypes} touchedByType={additionalDepositsTouched} setTouchedByType={setAdditionalDepositsTouched} errorsByType={additionalDepositErrors} setAdditionalDeposit={setAdditionalDeposit} />
                <BillingOptionsFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} isHistoricalStartDate={isHistoricalStartDate} />
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
