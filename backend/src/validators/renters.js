'use strict';

const { z } = require('zod');
const { phoneSchema, nameSchema, normalizeBeninPhone } = require('./auth');
const { RENT_TIMING_KEYS } = require('../constants/rentTiming');
const { idempotencyKeySchema } = require('./idempotency');
const { ADDITIONAL_DEPOSIT_TYPES } = require('../constants/leaseDeposits');
const { OPENING_DEBT_TYPE_KEYS, OPENING_DEBT_MONTHS_BACK } = require('../constants/openingDebt');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email invalide')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .nullable() // le front envoie `null` pour un champ optionnel vide (grilles d'état des lieux) — traité comme absent
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

// Contact d'un proche (personne à prévenir) — facultatif, ni le nom ni le numéro ne sont obligatoires
// (demande utilisateur, 2026-11-05). Même format béninois que le téléphone du locataire quand il est
// renseigné, mais jamais exigé.
const optionalPhoneSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((val, ctx) => {
    if (!val) return null;
    const normalized = normalizeBeninPhone(val);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Numéro béninois invalide (10 chiffres, ex. 0161234567)' });
      return z.NEVER;
    }
    return normalized;
  });

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Mois invalide (AAAA-MM)');
// Borne haute (étape 12) : au-delà, `z.coerce.number()` laissait passer des
// valeurs qui débordaient la colonne SQL → 500. 1 Md FCFA = plafond large.
const amountSchema = z.coerce
  .number()
  .int('Montant entier requis')
  .nonnegative('Montant invalide')
  .max(1_000_000_000, 'Montant hors limite');

const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

// Détail des impayés à l'entrée par type + mois (demande utilisateur, 2026-11-12) — voir
// constants/openingDebt.js. `periodMonth` doit rester dans les 12 derniers mois (même fenêtre que le
// sélecteur côté front) : un mois futur ou trop ancien n'a pas de sens pour un impayé déjà constaté.
function isWithinOpeningDebtWindow(periodMonth) {
  const now = new Date();
  const [y, m] = periodMonth.split('-').map(Number);
  const target = y * 12 + (m - 1);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return target <= current && target > current - OPENING_DEBT_MONTHS_BACK;
}
const openingDebtItemSchema = z.object({
  debtType: z.enum(OPENING_DEBT_TYPE_KEYS, { errorMap: () => ({ message: 'Type d\'impayé invalide' }) }),
  periodMonth: monthSchema.refine(isWithinOpeningDebtWindow, {
    message: `Le mois doit être dans les ${OPENING_DEBT_MONTHS_BACK} derniers mois`,
  }),
  label: optionalText(150),
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
});
const openingDebtItemsSchema = z.array(openingDebtItemSchema).max(60).optional();

// Création d'un locataire + son bail sur une Unité locative EXISTANTE (le
// Bien/l'Unité sont gérés depuis le module « Nos Biens » — voir routes/properties.js).
// Si une caution est demandée, son mode de règlement doit être précisé (pour
// générer sa contrepartie comptable — compte 165, voir glOperationTypes) ;
// sa date par défaut est celle du bail si non précisée.
const depositFields = {
  depositAmount: amountSchema.default(0),
  depositPaymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement de la caution invalide' }) }).optional(),
  depositPaidAt: dateSchema.optional(),
  // Remboursable ou non (demande utilisateur, 2026-11-12) : par défaut remboursable (comportement
  // historique) — une caution NON remboursable n'entre jamais dans le décompte de sortie, voir
  // `moveOutReport.js`. Sans effet tant que `depositAmount` est 0.
  depositRefundable: z.coerce.boolean().default(true),
};

function requireDepositMethodWhenDepositPositive(data, ctx) {
  if (data.depositAmount > 0 && !data.depositPaymentMethod) {
    ctx.addIssue({
      code: 'custom',
      path: ['depositPaymentMethod'],
      message: 'Mode de règlement requis pour la caution',
    });
  }
}

// Frais d'agence pris DIRECTEMENT au locataire à la signature du bail — 100 %
// produit du cabinet, jamais reversé au propriétaire (voir glOperationTypes
// `frais_agence_encaisse`). Même schéma que la caution (montant + mode de
// règlement, requis seulement si le montant est positif) ; sa date par
// défaut est celle du bail si non précisée.
const entryFeeFields = {
  entryFeeAmount: amountSchema.default(0),
  entryFeePaymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Mode de règlement des frais d'agence invalide" }) }).optional(),
  entryFeePaidAt: dateSchema.optional(),
};

function requireEntryFeeMethodWhenPositive(data, ctx) {
  if (data.entryFeeAmount > 0 && !data.entryFeePaymentMethod) {
    ctx.addIssue({
      code: 'custom',
      path: ['entryFeePaymentMethod'],
      message: "Mode de règlement requis pour les frais d'agence",
    });
  }
}

// Prorata d'entrée (étape 42) : SEUL le choix de politique vient du client — le montant et le nombre
// de jours sont TOUJOURS recalculés par le serveur (`computeEntryProrata`, à partir de `monthlyRent`/
// `startDate`/`rentDueDay` déjà soumis dans la même requête), jamais transmis ni fait confiance côté
// client. `entryProration` omis → retombe sur le réglage par défaut de l'entreprise (voir la route).
const entryProrationFields = {
  entryProration: z.enum(['aucun', 'prorata'], { errorMap: () => ({ message: "Choix du prorata d'entrée invalide" }) }).optional(),
  entryProrataPaymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Mode de règlement du prorata d'entrée invalide" }) }).optional(),
  entryProrataPaidAt: dateSchema.optional(),
};

// Cautions supplémentaires (étape 43, demande directe de l'utilisateur, 2026-09-28) — SBEE/SONEB/
// peinture, chacune optionnelle et indépendante de la caution de loyer ci-dessus (voir
// constants/leaseDeposits.js). Un type non activé pour l'entreprise, envoyé quand même, est
// simplement ignoré par le service (`recordAdditionalDeposits`), jamais une erreur de validation ici :
// la liste des types activés peut varier, ce n'est pas au client de la connaître à l'octet près.
const additionalDepositEntrySchema = z.object({
  amount: amountSchema,
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }).optional(),
  paidAt: dateSchema.optional(),
  // Même principe que `depositRefundable` ci-dessus, par caution supplémentaire (demande utilisateur,
  // 2026-11-12) — par défaut remboursable.
  refundable: z.coerce.boolean().default(true),
});
const additionalDepositsFields = {
  additionalDeposits: z
    .object(Object.fromEntries(ADDITIONAL_DEPOSIT_TYPES.map((t) => [t.key, additionalDepositEntrySchema.optional()])))
    .partial()
    .optional(),
};

function requireAdditionalDepositMethodWhenPositive(data, ctx) {
  if (!data.additionalDeposits) return;
  for (const type of ADDITIONAL_DEPOSIT_TYPES) {
    const entry = data.additionalDeposits[type.key];
    if (entry && entry.amount > 0 && !entry.paymentMethod) {
      ctx.addIssue({
        code: 'custom',
        path: ['additionalDeposits', type.key, 'paymentMethod'],
        message: `Mode de règlement requis pour la caution ${type.label}`,
      });
    }
  }
}

// Contradiction trouvée à l'audit du 2026-11-12 : rien côté serveur n'empêchait jusqu'ici d'envoyer
// `upToDateAtOnboarding: true` EN MÊME TEMPS qu'un impayé de loyer déclaré à l'entrée — seul le
// formulaire (use-new-renter-form.ts) décochait/masquait la case, un appel API direct passait sans
// erreur. Un poste `openingDebtItems` de type 'loyer' compte, de même qu'un `openingDebtAmount` global
// positif SANS aucun détail par type (repli « montant global historique », voir `openingDebtRouting.js`
// côté lecture — compté comme 100 % loyer dans ce cas).
function forbidUpToDateWithLoyerOpeningDebt(data, ctx) {
  if (!data.upToDateAtOnboarding) return;
  const items = data.openingDebtItems ?? [];
  const hasLoyerItem = items.some((item) => item.debtType === 'loyer');
  const hasLegacyLumpSum = items.length === 0 && data.openingDebtAmount > 0;
  if (hasLoyerItem || hasLegacyLumpSum) {
    ctx.addIssue({
      code: 'custom',
      path: ['upToDateAtOnboarding'],
      message: "Incohérent avec un loyer impayé déclaré à l'entrée : ce locataire n'est pas à jour sur son loyer",
    });
  }
}

const createRenterSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    phone: phoneSchema,
    email: emailSchema,
    profession: optionalText(150),
    notes: optionalText(2000),
    // Contact d'un proche à prévenir — facultatif (demande utilisateur, 2026-11-05).
    emergencyContactName: optionalText(150),
    emergencyContactPhone: optionalPhoneSchema,

    unitId: z.coerce.number().int('Unité requise').positive('Unité requise'),
    // Loyer optionnel : reprend celui de l'unité si absent (mais ajustable au bail).
    monthlyRent: amountSchema.refine((v) => v > 0, 'Le loyer doit être supérieur à 0').optional(),
    ...depositFields,
    ...entryFeeFields,
    ...entryProrationFields,
    ...additionalDepositsFields,
    rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
    // Refonte de la clôture (étape 2/5) : échéance pour un bail créé sous un tenant non-calendaire
    // (voir `leases.rent_due_offset_days`, migration 087) — la route choisit laquelle des deux
    // colonnes écrire selon le rythme réel du tenant (lu en base, pas dans ce payload), jamais les
    // deux. Défaut à 0 pour rester toujours défini, comme `rentDueDay` ci-dessus.
    rentDueOffsetDays: z.coerce.number().int().min(0).max(27).default(0),
    // Convention de paiement (avance/terme échu, demande directe de
    // l'utilisateur, 2026-09-24) : optionnel — si omis, la route retombe
    // sur le réglage par défaut de l'entreprise (tenants.default_rent_timing).
    rentTiming: z.enum(RENT_TIMING_KEYS, { errorMap: () => ({ message: 'Convention de paiement invalide' }) }).optional(),
    startDate: dateSchema,
    // Impayés existants à l'entrée (onboarding d'un locataire déjà en place
    // avant l'utilisation de Africa Immo Management) : montant déclaré une fois,
    // jamais modifié ensuite — se règle via son propre cycle de paiements,
    // voir POST /:leaseId/opening-debt/payments (routes/leases.js).
    openingDebtAmount: amountSchema.default(0),
    // Détail par type + mois (demande utilisateur, 2026-11-12) — quand fourni, remplace
    // `openingDebtAmount` ci-dessus : le serveur recalcule le total comme la somme de ces postes
    // (voir `insertLeaseWithEntries`, services/renters.js). `openingDebtAmount` reste utilisable seul
    // pour un montant global sans détail (ancien comportement, toujours valide).
    openingDebtItems: openingDebtItemsSchema,
    // À l'opposé : locataire déjà en place, mais SANS aucun impayé — évite
    // que la date d'entrée réelle (souvent ancienne) ne fasse remonter un
    // faux retard depuis avant l'enregistrement sur la plateforme (voir
    // `computeArrears`, services/rentTracking.js). Sans effet si
    // `startDate` est déjà proche d'aujourd'hui.
    upToDateAtOnboarding: z.coerce.boolean().default(false),
  })
  .superRefine(requireDepositMethodWhenDepositPositive)
  .superRefine(requireEntryFeeMethodWhenPositive)
  .superRefine(requireAdditionalDepositMethodWhenPositive)
  .superRefine(forbidUpToDateWithLoyerOpeningDebt);

// Nouveau bail pour un locataire déjà existant (renouvellement / changement
// d'unité) — alimente l'historique des contrats.
const createLeaseSchema = z
  .object({
    unitId: z.coerce.number().int('Unité requise').positive('Unité requise'),
    monthlyRent: amountSchema.refine((v) => v > 0, 'Le loyer doit être supérieur à 0').optional(),
    ...depositFields,
    ...entryFeeFields,
    ...entryProrationFields,
    ...additionalDepositsFields,
    rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
    // Refonte de la clôture (étape 2/5) : voir le commentaire détaillé sur `createRenterSchema`.
    rentDueOffsetDays: z.coerce.number().int().min(0).max(27).default(0),
    // Convention de paiement (avance/terme échu, demande directe de
    // l'utilisateur, 2026-09-24) : optionnel — si omis, la route retombe
    // sur le réglage par défaut de l'entreprise (tenants.default_rent_timing).
    rentTiming: z.enum(RENT_TIMING_KEYS, { errorMap: () => ({ message: 'Convention de paiement invalide' }) }).optional(),
    startDate: dateSchema,
    openingDebtAmount: amountSchema.default(0),
    openingDebtItems: openingDebtItemsSchema,
    upToDateAtOnboarding: z.coerce.boolean().default(false),
  })
  .superRefine(requireDepositMethodWhenDepositPositive)
  .superRefine(requireEntryFeeMethodWhenPositive)
  .superRefine(requireAdditionalDepositMethodWhenPositive)
  .superRefine(forbidUpToDateWithLoyerOpeningDebt);

const updateRenterSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  email: emailSchema.optional(),
  profession: optionalText(150).optional(),
  emergencyContactName: optionalText(150).optional(),
  emergencyContactPhone: optionalPhoneSchema.optional(),
});

// Note interne libre sur un locataire — schéma séparé de `updateRenterSchema` ci-dessus : voir
// PATCH /api/renters/:id/notes (routes/renters.js), volontairement accessible à tout employé, pas
// seulement qui a la permission "locataires".
const updateRenterNotesSchema = z.object({
  notes: optionalText(2000),
});

const endLeaseSchema = z.object({
  endDate: dateSchema,
});

const createPaymentSchema = z.object({
  // Facultatif : par défaut le serveur part du prochain mois dû. Si fourni, sert
  // de mois de départ (utile pour régler un mois précis en avance).
  coversMonth: monthSchema.optional(),
  // Peut dépasser un mois de loyer : le serveur répartit sur des mois
  // consécutifs (mois entiers + reste en paiement partiel), une quittance par mois.
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de paiement invalide' }) }),
  paidAt: dateSchema,
  notes: optionalText(255),
  // Clé d'idempotence (étape 36) : générée par le navigateur pour CET envoi ; deux envois de même
  // clé = un seul paiement. Facultative (ancien client) : le serveur retombe alors sur sa garde
  // héritée, qui compare mois, date, mode ET montant.
  idempotencyKey: idempotencyKeySchema,
});

// Conditions particulières du contrat de bail (étape 46) — seule partie personnalisable du contrat
// (le reste est calculé automatiquement depuis les données du bail), par bail, jamais par entreprise.
const updateContractSchema = z.object({
  particularConditions: optionalText(4000),
});

// Annulation d'un paiement de loyer (audit comptable, anomalie A3) — même
// principe que la suppression logique des dépenses/charges (validators/expenses.js) :
// justification obligatoire, jamais un DELETE physique.
const deletePaymentReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

// Pénalité de retard (montant TOUJOURS saisi à la main — jamais un barème
// automatique, choix de politique commerciale plutôt qu'une règle comptable).
const createLateFeeSchema = z.object({
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
  appliedAt: dateSchema,
  reason: optionalText(255),
  idempotencyKey: idempotencyKeySchema,
});

// Règlement (total ou partiel) de la dette initiale d'un bail — le serveur
// vérifie que le montant ne dépasse jamais le solde restant (routes/leases.js).
const createOpeningDebtPaymentSchema = z.object({
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de paiement invalide' }) }),
  paidAt: dateSchema,
  notes: optionalText(255),
  idempotencyKey: idempotencyKeySchema,
});

// Règlement (total ou partiel) d'une pénalité de retard déjà appliquée (étape 44bis) — même principe
// que la dette initiale ci-dessus, le serveur vérifie que le montant ne dépasse jamais le solde restant.
const createLateFeePaymentSchema = z.object({
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de paiement invalide' }) }),
  paidAt: dateSchema,
  notes: optionalText(255),
  idempotencyKey: idempotencyKeySchema,
});

module.exports = {
  createRenterSchema,
  updateRenterSchema,
  updateRenterNotesSchema,
  createLeaseSchema,
  endLeaseSchema,
  createPaymentSchema,
  deletePaymentReasonSchema,
  createLateFeeSchema,
  createLateFeePaymentSchema,
  createOpeningDebtPaymentSchema,
  // Règlement d'UN poste détaillé (type + mois) — même forme que le règlement global ci-dessus
  // (demande utilisateur, 2026-11-12) ; réexporté sous son propre nom pour la lisibilité des routes.
  createOpeningDebtItemPaymentSchema: createOpeningDebtPaymentSchema,
  updateContractSchema,
  PAYMENT_METHODS,
  // Primitives réutilisées par validators/inspections.js (états des lieux par zones).
  optionalText,
  dateSchema,
  amountSchema,
};
