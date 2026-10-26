'use strict';

const { z } = require('zod');
const { idempotencyKeySchema } = require('./idempotency');
const { INCOME_CATEGORY_KEYS } = require('../constants/incomes');
const { EXPENSE_PAYMENT_METHODS } = require('../constants/expenses');

const optionalText = (max) =>
  z.string().trim().max(max, 'Trop long').optional().or(z.literal('')).transform((v) => (v ? v : null));

const createIncomeSchema = z.object({
  category: z.enum(INCOME_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }),
  label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long'),
  amount: z.coerce
    .number()
    .int('Montant entier requis')
    .positive('Le montant doit être supérieur à 0')
    .max(1_000_000_000, 'Montant hors limite'),
  incomeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)'),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }),
  payerName: optionalText(150),
  reference: optionalText(100),
  notes: optionalText(255),
  idempotencyKey: idempotencyKeySchema,
});

module.exports = { createIncomeSchema };
