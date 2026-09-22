'use strict';

const { z } = require('zod');
const { PROPERTY_TYPE_KEYS, UNIT_DESIGNATION_KEYS, UNIT_STATUSES } = require('../constants/properties');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const propertyTypeSchema = z.enum(PROPERTY_TYPE_KEYS, {
  errorMap: () => ({ message: 'Type de bien invalide' }),
});

// Numéro de compteur SONEB/SBEE — format béninois réel : exactement 14
// caractères (indication directe de l'utilisateur, jamais deviné). Optionnel
// (une unité peut ne pas avoir son compteur suivi), mais s'il est renseigné,
// la longueur doit être exacte. L'unicité (un même compteur physique ne peut
// pas appartenir à deux Unités) est vérifiée séparément — voir
// routes/properties.js `assertMeterNumbersAvailable` + migration 059.
const meterNumberSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((v, ctx) => {
    if (!v) return null;
    if (v.length !== 14) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Le numéro de compteur doit contenir exactement 14 caractères' });
      return z.NEVER;
    }
    return v;
  });

// Coordonnées GPS (étape 13, idée n°10 : carte du portefeuille) : placées à la
// main par le DG sur une carte, jamais géocodées depuis l'adresse texte libre.
const latitudeSchema = z.coerce.number().min(-90, 'Latitude invalide').max(90, 'Latitude invalide');
const longitudeSchema = z.coerce.number().min(-180, 'Longitude invalide').max(180, 'Longitude invalide');

const coordinatesTogether = (data) => (data.latitude == null) === (data.longitude == null);
const coordinatesTogetherRefinement = {
  message: 'Latitude et longitude doivent être renseignées ensemble',
  path: ['longitude'],
};

// Le propriétaire est désormais une fiche à part entière (étape 5) : le Bien
// référence son id, sélectionné (ou créé à la volée) via /api/owners.
const createPropertySchema = z
  .object({
    ownerId: z.coerce.number().int('Propriétaire requis').positive('Propriétaire requis'),
    address: optionalText(255),
    propertyType: propertyTypeSchema,
    levels: z.coerce.number().int('Nombre entier requis').min(1).max(50).optional(),
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
  })
  .refine(coordinatesTogether, coordinatesTogetherRefinement);

const updatePropertySchema = z
  .object({
    ownerId: z.coerce.number().int('Propriétaire invalide').positive('Propriétaire invalide').optional(),
    address: optionalText(255).optional(),
    propertyType: propertyTypeSchema.optional(),
    levels: z.coerce.number().int('Nombre entier requis').min(1).max(50).optional(),
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
  })
  .refine(coordinatesTogether, coordinatesTogetherRefinement);

const unitDesignationSchema = z.enum(UNIT_DESIGNATION_KEYS, {
  errorMap: () => ({ message: 'Désignation invalide' }),
});

const createUnitSchema = z
  .object({
    designation: unitDesignationSchema,
    designationCustom: optionalText(150),
    monthlyRent: z.coerce.number().int('Montant entier requis').positive('Le loyer doit être supérieur à 0'),
    sonebMeterNumber: meterNumberSchema,
    sbeeMeterNumber: meterNumberSchema,
    furnished: z.coerce.boolean().optional().default(false),
  })
  .refine((data) => data.designation !== 'autre' || !!data.designationCustom, {
    message: 'Précisez la désignation de cette unité',
    path: ['designationCustom'],
  });

const updateUnitSchema = z.object({
  designation: unitDesignationSchema.optional(),
  designationCustom: optionalText(150).optional(),
  monthlyRent: z.coerce.number().int('Montant entier requis').positive().optional(),
  sonebMeterNumber: meterNumberSchema.optional(),
  sbeeMeterNumber: meterNumberSchema.optional(),
  furnished: z.coerce.boolean().optional(),
  status: z.enum(UNIT_STATUSES, { errorMap: () => ({ message: 'Statut invalide' }) }).optional(),
});

module.exports = {
  createPropertySchema,
  updatePropertySchema,
  createUnitSchema,
  updateUnitSchema,
};
