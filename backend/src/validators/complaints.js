'use strict';

const { z } = require('zod');
const { COMPLAINT_CATEGORY_KEYS, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES } = require('../constants/complaints');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');

const createComplaintSchema = z.object({
  leaseId: z.coerce.number().int('Bail requis').positive('Bail requis'),
  category: z.enum(COMPLAINT_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }),
  title: z.string().trim().min(3, 'Titre requis (3 caractères min.)').max(150, 'Trop long'),
  description: optionalText(2000),
  priority: z.enum(COMPLAINT_PRIORITIES, { errorMap: () => ({ message: 'Priorité invalide' }) }).default('normale'),
  reportedAt: dateSchema.optional(),
});

const updateComplaintSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }).optional(),
  title: z.string().trim().min(3, 'Titre requis (3 caractères min.)').max(150, 'Trop long').optional(),
  description: optionalText(2000).optional(),
  priority: z.enum(COMPLAINT_PRIORITIES, { errorMap: () => ({ message: 'Priorité invalide' }) }).optional(),
});

const updateComplaintStatusSchema = z
  .object({
    status: z.enum(COMPLAINT_STATUSES, { errorMap: () => ({ message: 'Statut invalide' }) }),
    resolutionNote: optionalText(2000),
  })
  .refine((data) => data.status !== 'resolue' || !!data.resolutionNote, {
    message: 'Une note de résolution est requise pour clore le dossier en « Résolue »',
    path: ['resolutionNote'],
  });

module.exports = {
  createComplaintSchema,
  updateComplaintSchema,
  updateComplaintStatusSchema,
};
