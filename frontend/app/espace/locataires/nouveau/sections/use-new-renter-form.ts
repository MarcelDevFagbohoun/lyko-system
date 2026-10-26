"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { createRenter, type PaymentMethod, type AdditionalDepositType } from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { normalizeBeninPhone } from "@/lib/validation/auth";
import { previewEntryProrata } from "@/lib/utils";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { useTenantRhythm } from "@/lib/hooks/use-tenant-rhythm";
import { buildRentDuePayload, validateRentDue } from "@/components/renters/rent-due-field";
import { todayIso } from "@/lib/dates";
import { ADDITIONAL_DEPOSIT_TYPES, FormState, INITIAL } from "./form-state";
import { CreatedRenter } from "./types";

export function useNewRenterForm() {
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


  return {
    accessToken,
    online,
    rhythm,
    isCalendaireRhythm,
    form,
    selectedUnit,
    touched,
    setTouched,
    additionalDepositsTouched,
    setAdditionalDepositsTouched,
    submitting,
    serverError,
    result,
    set,
    setAdditionalDeposit,
    enabledAdditionalDepositTypes,
    handleSelectUnit,
    isHistoricalStartDate,
    prorataPreview,
    errors,
    additionalDepositErrors,
    handleSubmit,
  };
}
