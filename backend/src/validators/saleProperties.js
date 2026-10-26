'use strict';

const { z } = require('zod');
const { SALE_PROPERTY_TYPE_KEYS, SALE_PROPERTY_STATUS_KEYS } = require('../constants/saleProperties');
const { idempotencyKeySchema } = require('./idempotency');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const typeSchema = z.enum(SALE_PROPERTY_TYPE_KEYS, { errorMap: () => ({ message: 'Type de bien invalide' }) });
// « vendu » n'est JAMAIS réglable via ce statut générique (demande utilisateur, 2026-10-18) : il exige
// le prix final, le pourcentage perçu et le mode de règlement — seul `POST /:id/mark-sold` (bouton
// « Vendu » dédié) peut faire cette transition, jamais un simple changement de statut.
const patchableStatusSchema = z.enum(
  SALE_PROPERTY_STATUS_KEYS.filter((s) => s !== 'vendu'),
  { errorMap: () => ({ message: "Statut invalide (passez par le bouton « Vendu » pour marquer une vente)" }) },
);

const createSalePropertySchema = z.object({
  type: typeSchema,
  title: z.string().trim().min(2, 'Trop court').max(150, 'Trop long'),
  address: optionalText(255),
  price: z.coerce.number().int('Montant entier requis').positive('Le prix doit être supérieur à 0'),
  surfaceM2: z.coerce.number().positive('Surface invalide').optional(),
  description: optionalText(2000),
  // Propriétaire optionnel (décision explicite de l'utilisateur, 2026-10-18) : un bien à vendre peut
  // exister sans fiche Propriétaire liée (bien propre au cabinet, ou propriétaire pas encore saisi).
  ownerId: z.coerce.number().int('Propriétaire invalide').positive('Propriétaire invalide').optional(),
});

const updateSalePropertySchema = z.object({
  type: typeSchema.optional(),
  title: z.string().trim().min(2, 'Trop court').max(150, 'Trop long').optional(),
  address: optionalText(255).optional(),
  price: z.coerce.number().int('Montant entier requis').positive('Le prix doit être supérieur à 0').optional(),
  surfaceM2: z.coerce.number().positive('Surface invalide').nullable().optional(),
  description: optionalText(2000).optional(),
  ownerId: z.coerce.number().int('Propriétaire invalide').positive('Propriétaire invalide').nullable().optional(),
  status: patchableStatusSchema.optional(),
});

// Suppression logique — même exigence que l'annulation d'un reversement/d'une charge.
const deleteSalePropertySchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

// Bouton « Vendu » (demande utilisateur, 2026-10-18) : prix final (peut différer du prix affiché —
// « le prix fixé peut s'améliorer »), pourcentage perçu par le cabinet, mode de règlement de cette
// commission. Le MONTANT de la commission est toujours calculé côté serveur (prix final × pourcentage),
// jamais transmis par le client.
const markSoldSchema = z.object({
  finalPrice: z.coerce.number().int('Montant entier requis').positive('Le prix final doit être supérieur à 0'),
  commissionPercent: z.coerce
    .number()
    .min(0, 'Le pourcentage doit être compris entre 0 et 100')
    .max(100, 'Le pourcentage doit être compris entre 0 et 100'),
  paymentMethod: z.enum(['especes', 'mobile_money', 'virement', 'cheque'], {
    errorMap: () => ({ message: 'Mode de règlement invalide' }),
  }),
  soldAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)').optional(),
  idempotencyKey: idempotencyKeySchema,
});

module.exports = {
  createSalePropertySchema,
  updateSalePropertySchema,
  deleteSalePropertySchema,
  markSoldSchema,
};
