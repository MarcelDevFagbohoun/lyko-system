'use strict';

const { z } = require('zod');
const { normalizeBeninPhone } = require('./auth');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

// Téléphone du propriétaire : facultatif, mais doit être un numéro béninois
// valide s'il est renseigné (même règle que pour le Bien à l'étape 4).
const ownerPhoneSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((v, ctx) => {
    if (!v) return null;
    const normalized = normalizeBeninPhone(v);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Numéro béninois invalide' });
      return z.NEVER;
    }
    return normalized;
  });

const emailSchema = z
  .string()
  .trim()
  .max(190, 'Trop long')
  .email('Email invalide')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const createOwnerSchema = z.object({
  name: z.string().trim().min(2, 'Requis').max(150, 'Trop long'),
  phone: ownerPhoneSchema,
  email: emailSchema,
  address: optionalText(255),
  notes: optionalText(2000),
});

const updateOwnerSchema = z.object({
  name: z.string().trim().min(2, 'Requis').max(150, 'Trop long').optional(),
  phone: ownerPhoneSchema.optional(),
  email: emailSchema.optional(),
  address: optionalText(255).optional(),
  notes: optionalText(2000).optional(),
});

const createPayoutSchema = z.object({
  amount: z.coerce
    .number()
    .int('Montant entier requis')
    .positive('Le montant doit être supérieur à 0')
    .max(1_000_000_000, 'Montant hors limite'), // borne haute (étape 12) : évite le débordement SQL → 500
  periodLabel: z.string().trim().min(1, 'Requis').max(50, 'Trop long'),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  paymentMethod: z.enum(['especes', 'mobile_money', 'virement', 'cheque'], {
    errorMap: () => ({ message: 'Mode de règlement invalide' }),
  }),
  notes: optionalText(255),
});

// Reversement des charges SONEB/SBEE encaissées (étape 31) : même forme qu'un
// versement de loyer, libellé de période facultatif (« Charges septembre »).
const createChargeRemittanceSchema = z.object({
  amount: z.coerce
    .number()
    .int('Montant entier requis')
    .positive('Le montant doit être supérieur à 0')
    .max(1_000_000_000, 'Montant hors limite'),
  periodLabel: optionalText(50),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  paymentMethod: z.enum(['especes', 'mobile_money', 'virement', 'cheque'], {
    errorMap: () => ({ message: 'Mode de règlement invalide' }),
  }),
  notes: optionalText(255),
});

// Annulation = suppression logique avec justification obligatoire.
const cancelChargeRemittanceSchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

// Nouveau taux de commission (DG uniquement) : pourcentage borné [0, 100],
// avec deux décimales (ex. 12.5 %). `startsOn` facultatif — la route
// applique aujourd'hui par défaut si absent.
const updateCommissionRateSchema = z.object({
  rate: z.coerce
    .number()
    .min(0, 'Le taux doit être compris entre 0 et 100')
    .max(100, 'Le taux doit être compris entre 0 et 100'),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)').optional(),
});

// Requête de recette d'un Bien : mois au format 'AAAA-MM'.
const recetteQuerySchema = z.object({
  mois: z.string().regex(/^\d{4}-\d{2}$/, 'Mois invalide (AAAA-MM)'),
});

module.exports = {
  createOwnerSchema,
  updateOwnerSchema,
  createPayoutSchema,
  createChargeRemittanceSchema,
  cancelChargeRemittanceSchema,
  updateCommissionRateSchema,
  recetteQuerySchema,
};
