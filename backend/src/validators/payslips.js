'use strict';

const { z } = require('zod');
const { idempotencyKeySchema } = require('./idempotency');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const amountSchema = (label) =>
  z.coerce.number().int(`${label} : montant entier requis`).nonnegative(`${label} : montant invalide`).max(1_000_000_000, 'Montant hors limite');

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');

const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

/**
 * Fiche de paie (demande utilisateur, 2026-10-18) : salaire de base + primes éventuelles + retenues
 * (ex. avance déjà versée) → net à payer, toujours calculé côté serveur, jamais transmis par le
 * client. `deductionAmount` ne peut jamais dépasser `baseAmount + bonusAmount` (un net négatif n'a
 * aucun sens pour un salaire réellement versé).
 */
const createPayslipSchema = z
  .object({
    userId: z.coerce.number().int('Employé invalide').positive('Employé invalide'),
    period: periodSchema,
    baseAmount: amountSchema('Salaire de base'),
    bonusAmount: amountSchema('Prime').optional().default(0),
    bonusLabel: optionalText(150),
    deductionAmount: amountSchema('Retenue').optional().default(0),
    deductionLabel: optionalText(150),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Mode de règlement invalide' }),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)'),
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((data, ctx) => {
    const gross = data.baseAmount + data.bonusAmount;
    if (data.deductionAmount > gross) {
      ctx.addIssue({ code: 'custom', path: ['deductionAmount'], message: 'La retenue ne peut pas dépasser le salaire brut.' });
    }
    if (gross - data.deductionAmount <= 0) {
      ctx.addIssue({ code: 'custom', path: ['deductionAmount'], message: 'Le net à payer doit être supérieur à 0.' });
    }
  });

const updateBaseSalarySchema = z.object({
  baseSalary: z.coerce.number().int('Montant entier requis').nonnegative('Montant invalide').max(1_000_000_000, 'Montant hors limite').nullable(),
});

const deletePayslipSchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

module.exports = { createPayslipSchema, updateBaseSalarySchema, deletePayslipSchema };
