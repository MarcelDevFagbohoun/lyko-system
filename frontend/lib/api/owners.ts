import { apiFetch, type Actor } from "./client";
import type { PaymentMethod } from "./renters";
import type { PropertyTypeKey } from "./properties";
import type { ChargeAccount, MainPaymentMethod } from "./charges";

export type Owner = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdBy: Actor;
  createdAt: string;
  /** Un lien de portail a déjà été généré pour ce propriétaire (jamais le token lui-même). */
  hasPortalLink: boolean;
  portalLinkCreatedAt: string | null;
  /** Archive des propriétaires (étape du 2026-10-18) — mandat terminé volontairement par le DG,
   * jamais automatique. `null` = mandat actif. Fiche en lecture seule une fois renseigné. */
  mandateEndedAt: string | null;
  mandateEndedBy: Actor;
  mandateEndReason: string | null;
};

export type OwnerListItem = Owner & {
  propertiesCount: number;
  unitsCount: number;
  unitsOccupied: number;
  monthlyRentTotal: number;
};

export type OwnerUnit = {
  id: number;
  code: string;
  designationLabel: string;
  status: "libre" | "loue" | "reserve";
  monthlyRent: number;
  currentRenter: string | null;
};

export type OwnerProperty = {
  id: number;
  code: string;
  address: string | null;
  type: PropertyTypeKey;
  typeLabel: string;
  levels: number | null;
  units: OwnerUnit[];
};

export type OwnerPayout = {
  id: number;
  amount: number;
  periodLabel: string;
  paidAt: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  notes: string | null;
  recordedBy: Actor;
};

/** Reversement au propriétaire de charges SONEB/SBEE déjà encaissées chez ses locataires (étape 31). */
export type OwnerChargeRemittance = {
  id: number;
  amount: number;
  periodLabel: string | null;
  paidAt: string;
  paymentMethod: MainPaymentMethod;
  paymentMethodLabel: string;
  notes: string | null;
  recordedBy: Actor;
  createdAt: string;
};

export function listOwners(accessToken: string, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<{ owners: OwnerListItem[] }>(`/api/owners${qs}`, { accessToken });
}

/** Un taux de commission historisé : `endsOn: null` = taux actif. */
export type CommissionRate = {
  id: number;
  rate: number;
  startsOn: string;
  endsOn: string | null;
  setBy: Actor;
  createdAt: string;
};

/**
 * Compte séquestre par mandat (comptabilité simple) : recette nette
 * cumulée depuis toujours (tous les Biens de ce propriétaire, commission
 * déjà déduite) moins les versements déjà effectués — ce que le cabinet
 * détient ACTUELLEMENT pour son compte.
 */
export type EscrowBalance = {
  totalCollected: number;
  totalPayouts: number;
  balance: number;
  /** Détail de ce qui compose la recette nette cumulée (étape 42), montants BRUTS avant commission :
   * loyers, dette initiale réglée, prorata d'entrée — les deux derniers appartiennent au propriétaire
   * au même titre qu'un loyer. */
  breakdown: { rent: number; openingDebt: number; prorata: number; expenses: number };
};

/**
 * Cautions actuellement détenues (demande utilisateur, 2026-10-17) — jamais mélangées à
 * `EscrowBalance` ci-dessus : une caution n'est pas un revenu, c'est l'argent du locataire, conservé
 * puis restitué. `depositLoyer` = caution de loyer (`leases.deposit_amount`), les trois autres =
 * cautions supplémentaires (étape 43, SBEE/SONEB/peinture) — seulement celles non encore restituées.
 */
export type DepositsHeld = {
  total: number;
  breakdown: { depositLoyer: number; sbee: number; soneb: number; peinture: number };
  /** Part déjà remise au propriétaire (due aux locataires, détenue par lui). */
  withOwner?: number;
};

export type DepositType = "loyer" | "sbee" | "soneb" | "peinture";
/** Une caution encore détenue : montant total, part restée au cabinet et part remise au propriétaire. */
export type DepositPosition = {
  leaseId: number;
  type: DepositType;
  typeLabel: string;
  amount: number;
  renterName: string;
  unitCode: string;
  propertyCode: string;
  withOwner: number;
  atCabinet: number;
};
export type DepositTransfer = {
  id: number;
  leaseId: number;
  renterName: string;
  unitCode: string;
  depositType: DepositType;
  typeLabel: string;
  direction: "to_owner" | "from_owner";
  amount: number;
  paidAt: string;
  paymentMethod: string;
  motive: string;
  requestedByOwner: boolean;
  recordedByName: string | null;
};
export type CreateDepositTransferInput = {
  leaseId: number;
  depositType: DepositType;
  direction: "to_owner" | "from_owner";
  amount: number;
  paidAt: string;
  paymentMethod: "especes" | "mobile_money" | "virement" | "cheque";
  motive: string;
  requestedByOwner: boolean;
};
export function createDepositTransfer(accessToken: string, ownerId: number, input: CreateDepositTransferInput) {
  return apiFetch<{ transferId: number }>(`/api/owners/${ownerId}/deposit-transfers`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getOwner(accessToken: string, id: number) {
  return apiFetch<{
    owner: Owner;
    properties: OwnerProperty[];
    escrowBalance: EscrowBalance;
    depositsHeld: DepositsHeld;
    depositPositions: { items: DepositPosition[]; withOwnerTotal: number };
    depositTransfers: DepositTransfer[];
    /** Impayés des locataires à l'entrée, non réglés (montant brut, jamais mélangé à `escrowBalance`). */
    openingDebtUnpaid: number;
    payouts: OwnerPayout[];
    /** Charges SONEB/SBEE encaissées / déjà reversées / à reverser — séparé du séquestre des loyers. */
    chargesAccount: ChargeAccount;
    chargeRemittances: OwnerChargeRemittance[];
    activeCommissionRate: CommissionRate | null;
    commissionRates: CommissionRate[];
  }>(`/api/owners/${id}`, { accessToken });
}

export type CreateOwnerInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export function createOwner(accessToken: string, input: CreateOwnerInput) {
  return apiFetch<{ ownerId: number }>("/api/owners", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type UpdateOwnerInput = Partial<CreateOwnerInput>;

export function updateOwner(accessToken: string, id: number, input: UpdateOwnerInput) {
  return apiFetch<{ owner: Owner }>(`/api/owners/${id}`, {
    method: "PATCH",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Archive ce propriétaire (DG uniquement) — bloqué tant qu'il a encore au moins un Bien rattaché. */
export function endOwnerMandate(accessToken: string, id: number, reason: string) {
  return apiFetch<{ owner: Owner }>(`/api/owners/${id}/end-mandate`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

/** Unique porte de sortie de l'archive (ex. un règlement tardif après le départ) — DG uniquement. */
export function reactivateOwnerMandate(accessToken: string, id: number) {
  return apiFetch<{ owner: Owner }>(`/api/owners/${id}/reactivate-mandate`, {
    method: "POST",
    accessToken,
  });
}

export type CreatePayoutInput = {
  amount: number;
  periodLabel: string;
  paidAt: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  /** Clé d'idempotence de CET envoi (voir `useIdempotencyKey`). */
  idempotencyKey?: string;
};

export function createPayout(accessToken: string, ownerId: number, input: CreatePayoutInput) {
  return apiFetch<{ payoutId: number }>(`/api/owners/${ownerId}/payouts`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type CreateChargeRemittanceInput = {
  amount: number;
  paidAt: string;
  paymentMethod: MainPaymentMethod;
  periodLabel?: string;
  notes?: string;
  /** Clé d'idempotence de CET envoi (voir `useIdempotencyKey`). */
  idempotencyKey?: string;
};

export function createChargeRemittance(accessToken: string, ownerId: number, input: CreateChargeRemittanceInput) {
  return apiFetch<{ remittanceId: number; accountingNote: string | null }>(`/api/owners/${ownerId}/charge-remittances`, {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Annulation logique : la trace reste, le montant redevient « à reverser ». Justification obligatoire. */
export function cancelChargeRemittance(accessToken: string, ownerId: number, remittanceId: number, reason: string) {
  return apiFetch<void>(`/api/owners/${ownerId}/charge-remittances/${remittanceId}`, {
    method: "DELETE",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export function statementPdfPath(ownerId: number) {
  return `/api/owners/${ownerId}/statement.pdf`;
}

export type UpdateCommissionRateInput = {
  rate: number;
  /** Facultatif : aujourd'hui par défaut côté serveur. */
  startsOn?: string;
};

/**
 * Nouveau taux de commission (DG uniquement) — clôture le taux actif et en
 * crée un nouveau, jamais un écrasement (historique préservé).
 */
export function updateCommissionRate(accessToken: string, ownerId: number, input: UpdateCommissionRateInput) {
  return apiFetch<{ rateId: number; rate: number; startsOn: string; endsOn: null }>(
    `/api/owners/${ownerId}/commission-rate`,
    {
      method: "PUT",
      accessToken,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

/**
 * (Re)génère le lien du portail propriétaire (étape 13, idée n°1). Le token
 * n'est renvoyé qu'une seule fois ici, jamais stocké en clair côté serveur —
 * régénérer invalide l'ancien lien.
 */
export function generateOwnerPortalLink(accessToken: string, ownerId: number) {
  return apiFetch<{ token: string; path: string }>(`/api/owners/${ownerId}/portal-link`, {
    method: "POST",
    accessToken,
  });
}
