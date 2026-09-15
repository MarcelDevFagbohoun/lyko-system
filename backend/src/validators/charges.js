'use strict';

const { z } = require('zod');
const { UTILITY_TYPE_KEYS, LOSS_ALLOCATION_MODES } = require('../constants/charges');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
// Bornes hautes (étape 12) : le montant facturé = (readingEnd - readingStart)
// × unitPrice ; sans plafond, des valeurs extrêmes débordaient la colonne SQL
// (DECIMAL(12,0)) → 500. Ces plafonds (index ≤ ~10 M, prix ≤ ~10 000 FCFA)
// couvrent très largement tout compteur SONEB/SBEE réel, produit < 1e11.
const readingSchema = z.coerce.number().int('Index entier requis').nonnegative('Index invalide').max(9_999_999, 'Index hors limite');
const unitPriceSchema = z.coerce.number().positive('Le prix unitaire doit être supérieur à 0').max(9_999, 'Prix unitaire hors limite');
const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

// Index de relevé obligatoires : le montant est TOUJOURS calculé (consommation
// × prix unitaire), jamais saisi directement — donc les deux valeurs qui
// permettent ce calcul sont requises, pas informatives.
const createChargeSchema = z
  .object({
    leaseId: z.coerce.number().int('Bail requis').positive('Bail requis'),
    utilityType: z.enum(UTILITY_TYPE_KEYS, { errorMap: () => ({ message: 'Type de fluide invalide' }) }),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    readingStart: readingSchema,
    readingEnd: readingSchema,
    unitPrice: unitPriceSchema,
    billedAt: dateSchema,
    notes: optionalText(255),
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: 'La fin de période doit être postérieure ou égale au début',
    path: ['periodEnd'],
  })
  .refine((data) => data.readingEnd >= data.readingStart, {
    message: "L'index de fin doit être supérieur ou égal à l'index de début",
    path: ['readingEnd'],
  });

const updateChargeSchema = z
  .object({
    utilityType: z.enum(UTILITY_TYPE_KEYS, { errorMap: () => ({ message: 'Type de fluide invalide' }) }).optional(),
    periodStart: dateSchema.optional(),
    periodEnd: dateSchema.optional(),
    readingStart: readingSchema.optional(),
    readingEnd: readingSchema.optional(),
    unitPrice: unitPriceSchema.optional(),
    billedAt: dateSchema.optional(),
    notes: optionalText(255).optional(),
  })
  .refine((data) => !(data.periodStart && data.periodEnd) || data.periodEnd >= data.periodStart, {
    message: 'La fin de période doit être postérieure ou égale au début',
    path: ['periodEnd'],
  })
  .refine((data) => !(data.readingStart !== undefined && data.readingEnd !== undefined) || data.readingEnd >= data.readingStart, {
    message: "L'index de fin doit être supérieur ou égal à l'index de début",
    path: ['readingEnd'],
  });

// Paiement partiel ou total d'une facture (étape 23) : plusieurs paiements
// successifs possibles, comme pour le loyer (rent_payments).
const amountSchema = z.coerce.number().int('Montant entier requis').positive('Montant invalide').max(1_000_000_000, 'Montant hors limite');
const createUtilityPaymentSchema = z.object({
  amount: amountSchema,
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }),
  paidAt: dateSchema,
  notes: optionalText(255),
});

// Suppression = suppression logique (traçabilité) : une justification est
// systématiquement exigée, quel que soit le rôle de qui supprime.
const deleteReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

// ── Relevé de compteurs par immeuble (étape 9bis) ─────────────────────────

const nullablePrice = unitPriceSchema.nullable().optional();

const lossAllocationSchema = z.enum(LOSS_ALLOCATION_MODES, { errorMap: () => ({ message: 'Répartition invalide' }) }).optional();

/** Config sous-comptage d'un Bien (PATCH partiel). */
const utilityConfigSchema = z.object({
  sonebSubmetered: z.coerce.boolean().optional(),
  sbeeSubmetered: z.coerce.boolean().optional(),
  sonebUnitPrice: nullablePrice,
  sbeeUnitPrice: nullablePrice,
  sonebMainMeterNumber: optionalText(50).optional(),
  sbeeMainMeterNumber: optionalText(50).optional(),
  sonebAccountNumber: optionalText(50).optional(),
  sbeeAccountNumber: optionalText(50).optional(),
  sonebLossAllocation: lossAllocationSchema,
  sbeeLossAllocation: lossAllocationSchema,
});

/** Création d'un relevé : fluide + période. Le tarif et les décompteurs sont dérivés du Bien. */
const createBatchSchema = z
  .object({
    utilityType: z.enum(UTILITY_TYPE_KEYS, { errorMap: () => ({ message: 'Type de fluide invalide' }) }),
    periodStart: dateSchema,
    periodEnd: dateSchema,
  })
  .refine((d) => d.periodEnd >= d.periodStart, {
    message: 'La fin de période doit être postérieure ou égale au début',
    path: ['periodEnd'],
  });

const readingRowSchema = z
  .object({
    unitId: z.coerce.number().int('Unité invalide').positive('Unité invalide'),
    readingStart: readingSchema,
    readingEnd: readingSchema,
  })
  .refine((d) => d.readingEnd >= d.readingStart, {
    message: "L'index de fin doit être supérieur ou égal à l'index de début",
    path: ['readingEnd'],
  });

/** Enregistrement de la grille (brouillon) : compteur principal + lignes décompteurs. */
const saveBatchSchema = z.object({
  mainReadingStart: readingSchema.nullable().optional(),
  mainReadingEnd: readingSchema.nullable().optional(),
  mainInvoiceAmount: z.coerce
    .number()
    .int('Montant entier requis')
    .nonnegative('Montant invalide')
    .max(1_000_000_000, 'Montant hors limite')
    .nullable()
    .optional(),
  readings: z.array(readingRowSchema).max(300, 'Trop de lignes').default([]),
});

module.exports = {
  createChargeSchema,
  updateChargeSchema,
  createUtilityPaymentSchema,
  deleteReasonSchema,
  utilityConfigSchema,
  createBatchSchema,
  saveBatchSchema,
};
