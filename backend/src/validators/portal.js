'use strict';

const { z } = require('zod');
const { COMPLAINT_CATEGORY_KEYS, COMPLAINT_PRIORITIES } = require('../constants/complaints');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

// Plainte signalée depuis le portail locataire : pas de `leaseId` (implicite
// — le bail actif du locataire authentifié par son token) ni de photos
// (portail volontairement minimal, v1).
const portalComplaintSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }),
  title: z.string().trim().min(3, 'Titre requis (3 caractères min.)').max(150, 'Trop long'),
  description: optionalText(2000),
  priority: z.enum(COMPLAINT_PRIORITIES, { errorMap: () => ({ message: 'Priorité invalide' }) }).default('normale'),
});

module.exports = { portalComplaintSchema };
