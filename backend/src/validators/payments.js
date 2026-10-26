'use strict';

const { z } = require('zod');

const amount = (label) =>
  z.coerce.number({ invalid_type_error: `${label} invalide` }).int(`${label} : montant entier requis`).positive(`${label} : doit être supérieur à 0`).max(100_000_000, 'Montant hors limite');
const nonNegative = (label) =>
  z.coerce.number().int(`${label} : montant entier requis`).nonnegative(`${label} invalide`).max(100_000_000, 'Montant hors limite');
const text = (min, max, label) => z.string().trim().min(min, `${label} requis`).max(max, `${label} trop long`);
const optionalText = (max) => z.string().trim().max(max, 'Trop long').optional().or(z.literal('')).transform((v) => (v ? v : null));
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');
const email = z.string().trim().toLowerCase().email('E-mail invalide').max(190).optional().or(z.literal('')).transform((v) => (v ? v : null));

// Champs communs à tout envoi d'argent. `.strict()` partout : un champ inattendu est une erreur, jamais ignoré en silence.
const common = {
  phone: z.string().trim().min(8, 'Numéro invalide').max(20, 'Numéro invalide'),
  operator: z.enum(['mtn', 'moov'], { error: 'Opérateur invalide' }),
  beneficiaryEmail: email,
  password: z.string().min(1, 'Mot de passe requis').max(200),
  // OBLIGATOIRE pour un envoi d'argent : un double-clic ou un rejeu réseau ne doit jamais payer deux fois.
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Clé d\'idempotence invalide'),
};

const salaryOrder = z
  .object({
    purpose: z.literal('salaire'),
    userId: z.coerce.number().int().positive('Employé invalide'),
    period,
    baseAmount: amount('Salaire de base'),
    bonusAmount: nonNegative('Prime').optional().default(0),
    bonusLabel: optionalText(150),
    deductionAmount: nonNegative('Retenue').optional().default(0),
    deductionLabel: optionalText(150),
    ...common,
    // Le n° Mobile Money peut être omis : celui mémorisé sur la fiche de l'employé est alors utilisé.
    phone: common.phone.optional(),
    operator: common.operator.optional(),
    saveNumber: z.boolean().optional().default(false),
  })
  .strict();

const ownerOrder = z
  .object({
    purpose: z.literal('reversement_proprietaire'),
    ownerId: z.coerce.number().int().positive('Propriétaire invalide'),
    amount: amount('Montant'),
    periodLabel: text(1, 50, 'Période'),
    ...common,
  })
  .strict();

const otherOrder = z
  .object({
    purpose: z.literal('autre'),
    beneficiaryName: text(2, 100, 'Nom du bénéficiaire'),
    amount: amount('Montant'),
    label: text(3, 190, 'Motif'),
    ...common,
  })
  .strict();

const createOrderSchema = z.discriminatedUnion('purpose', [salaryOrder, ownerOrder, otherOrder]);

const listOrdersQuery = z.object({
  status: z.enum(['created', 'processing', 'sent', 'failed']).optional(),
  purpose: z.enum(['salaire', 'reversement_proprietaire', 'autre']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

const listHistoryQuery = z.object({
  kind: z.enum(['salaire', 'reversement_proprietaire', 'reversement_charges', 'depense', 'restitution_caution']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

module.exports = { createOrderSchema, listOrdersQuery, listHistoryQuery };
