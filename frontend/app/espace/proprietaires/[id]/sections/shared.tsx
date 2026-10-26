"use client";

import { type CreatePayoutInput } from "@/lib/api/owners";


export const UNIT_STATUS_BADGE = {
  libre: { variant: "success" as const, label: "Libre" },
  loue: { variant: "neutral" as const, label: "Loué" },
  reserve: { variant: "warning" as const, label: "Réservé" },
};

export const PAYMENT_METHODS: { value: CreatePayoutInput["paymentMethod"]; label: string }[] = [
  { value: "virement", label: "Virement" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "especes", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
];

