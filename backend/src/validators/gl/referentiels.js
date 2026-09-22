'use strict';

const { z } = require('zod');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');

// Sous-compte personnalisé (ex. 4111 sous 411) — jamais un compte système :
// `is_system` reste toujours à 0 pour un compte créé depuis cette route.
const createAccountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,8}$/, 'Numéro de compte invalide (chiffres uniquement, 3 à 8)'),
  label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long'),
  class: z.coerce.number().int().min(1).max(9),
  accountType: z.enum(['actif', 'passif', 'charge', 'produit', 'autre'], {
    errorMap: () => ({ message: 'Type de compte invalide' }),
  }),
  isControlAccount: z.coerce.boolean().optional().default(false),
  parentAccountId: z.coerce.number().int().positive().optional(),
});

// Renommer un compte SYSTÈME "renommable" (voir constants/glRenameableAccounts.js) —
// SEUL le numéro change, jamais le libellé/type : ce n'est pas une création
// de compte, juste un choix de numérotation laissé au DG. Minimum 2 chiffres
// (pas 3, contrairement à `createAccountSchema`) : l'alternative "46" citée
// en exemple pour le compte propriétaires mandants doit rester saisissable.
const renameAccountSchema = z.object({
  code: z.string().trim().regex(/^\d{2,8}$/, 'Numéro de compte invalide (chiffres uniquement, 2 à 8)'),
});

const createFiscalYearSchema = z.object({
  label: z.string().trim().min(1, 'Libellé requis').max(20, 'Trop long'),
  startDate: dateSchema,
  endDate: dateSchema,
});

// Champs volontairement limités : jamais de reconfiguration des comptes/
// montants d'une règle depuis cette route (trop sensible pour un simple
// formulaire) — seulement l'activation, le libellé et la validation experte.
const updatePostingRuleSchema = z.object({
  label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long').optional(),
  narrationTemplate: z.string().trim().min(2, 'Modèle de libellé requis').max(255, 'Trop long').optional(),
  isActive: z.coerce.boolean().optional(),
  isValidatedByAccountant: z.coerce.boolean().optional(),
});

module.exports = { createAccountSchema, renameAccountSchema, createFiscalYearSchema, updatePostingRuleSchema };
