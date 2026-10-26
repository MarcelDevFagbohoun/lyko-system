"use client";

import { type AdditionalDeposit, type EntryReceiptRef } from "@/lib/api/renters";


export type CreatedRenter = {
  renterId: number;
  leaseId: number;
  firstName: string;
  phone: string;
  portalUrl: string;
  entryProrata: { proration: "aucun" | "prorata"; amount: number; days: number; dueDate: string };
  additionalDeposits: AdditionalDeposit[];
  entryReceipt: EntryReceiptRef;
};

