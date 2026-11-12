"use client";

import { type RentTiming, type AdditionalDepositType, type OpeningDebtType } from "@/lib/api/renters";
import { todayIso } from "@/lib/dates";

/**
 * Détail des impayés à l'entrée par type + mois (demande utilisateur, 2026-11-12) : pour chaque type,
 * les mois sélectionnés (AAAA-MM) avec leur montant saisi — « loyer » est pré-rempli automatiquement
 * depuis `monthlyRent` à la sélection d'un mois (surchargeable), les autres types démarrent vides.
 */
export type OpeningDebtItemsState = Record<OpeningDebtType, Record<string, string>>;

export const EMPTY_OPENING_DEBT_ITEMS: OpeningDebtItemsState = {
  loyer: {},
  sbee: {},
  soneb: {},
  poubelle: {},
  autre: {},
};


export type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  profession: string;
  /** Contact d'un proche (personne à prévenir) — facultatif (demande utilisateur, 2026-11-05). */
  emergencyContactName: string;
  emergencyContactPhone: string;
  monthlyRent: string;
  depositAmount: string;
  depositPaymentMethod: string;
  depositPaidAt: string;
  /** Caution remboursable ou non (demande utilisateur, 2026-11-12) — si false, jamais rendue à la sortie, acquise au propriétaire d'office. */
  depositRefundable: boolean;
  entryFeeAmount: string;
  entryFeePaymentMethod: string;
  entryFeePaidAt: string;
  entryProration: "aucun" | "prorata";
  entryProrataPaymentMethod: string;
  entryProrataPaidAt: string;
  additionalDeposits: Record<AdditionalDepositType, { amount: string; paymentMethod: string; paidAt: string; refundable: boolean }>;
  rentDueDay: string;
  rentTiming: RentTiming;
  startDate: string;
  openingDebtAmount: string;
  openingDebtItems: OpeningDebtItemsState;
  upToDateAtOnboarding: boolean;
};

export const INITIAL: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  profession: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  monthlyRent: "",
  depositAmount: "",
  depositPaymentMethod: "",
  depositPaidAt: todayIso(),
  depositRefundable: true,
  entryFeeAmount: "",
  entryFeePaymentMethod: "",
  entryFeePaidAt: todayIso(),
  entryProration: "aucun",
  entryProrataPaymentMethod: "",
  entryProrataPaidAt: todayIso(),
  additionalDeposits: {
    sbee: { amount: "", paymentMethod: "", paidAt: todayIso(), refundable: true },
    soneb: { amount: "", paymentMethod: "", paidAt: todayIso(), refundable: true },
    peinture: { amount: "", paymentMethod: "", paidAt: todayIso(), refundable: true },
  },
  rentDueDay: "5",
  rentTiming: "avance",
  startDate: todayIso(),
  openingDebtAmount: "",
  openingDebtItems: EMPTY_OPENING_DEBT_ITEMS,
  upToDateAtOnboarding: false,
};

export const DEPOSIT_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

// Cautions supplémentaires (étape 43) — même catalogue que constants/leaseDeposits.js (backend).
export const ADDITIONAL_DEPOSIT_TYPES: {
  key: AdditionalDepositType;
  label: string;
  enabledKey: "depositSbeeEnabled" | "depositSonebEnabled" | "depositPeintureEnabled";
}[] = [
  { key: "sbee", label: "Caution SBEE (électricité)", enabledKey: "depositSbeeEnabled" },
  { key: "soneb", label: "Caution SONEB (eau)", enabledKey: "depositSonebEnabled" },
  { key: "peinture", label: "Caution peinture", enabledKey: "depositPeintureEnabled" },
];

