'use strict';

const { z } = require('zod');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

const payIrfSchema = z.object({
  amount: z.coerce.number().int('Montant entier requis').positive('Le montant doit être supérieur à 0'),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }),
  paidAt: dateSchema,
});

module.exports = { payIrfSchema };
