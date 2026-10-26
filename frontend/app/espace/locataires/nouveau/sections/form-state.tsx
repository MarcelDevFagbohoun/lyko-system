"use client";

import { type RentTiming, type AdditionalDepositType } from "@/lib/api/renters";
import { todayIso } from "@/lib/dates";


export type FormState = {
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

export const INITIAL: FormState = {
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

