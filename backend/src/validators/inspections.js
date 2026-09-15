'use strict';

const { z } = require('zod');
const { optionalText, dateSchema, amountSchema } = require('./renters');
const { INSPECTION_CONDITIONS } = require('../constants/inspection');

// Identifiant de zone/élément (stable ou généré côté client pour un ajout
// personnalisé) — jamais interpolé dans une requête SQL ou un chemin de
// fichier, mais borné par prudence.
const keySchema = z.string().trim().regex(/^[a-z0-9_-]{1,80}$/i, 'Identifiant invalide');

// `deduction` n'a de sens que pour une fiche de SORTIE, mais reste dans la
// même forme d'élément pour l'entrée (ignorée, toujours à 0) — un seul
// schéma, une seule forme côté frontend, pas de duplication.
const inspectionItemSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(150),
  custom: z.boolean().default(false),
  condition: z
    .enum(INSPECTION_CONDITIONS, { errorMap: () => ({ message: 'État invalide (BE/ME/SR)' }) })
    .nullable()
    .default(null),
  comment: optionalText(500),
  // Chemin déjà enregistré par POST .../photo — jamais fixé directement par
  // le client à une valeur arbitraire de son choix (voir la route : elle
  // ignore ce champ pour l'élément qu'elle vient de mettre à jour).
  photoUrl: z.string().trim().max(500).nullable().optional(),
  deduction: amountSchema.default(0),
});

const inspectionZoneSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(150),
  custom: z.boolean().default(false),
  items: z.array(inspectionItemSchema).min(1, 'Une zone doit contenir au moins un élément'),
});

const startInspectionReportSchema = z.object({
  conductedAt: dateSchema.optional(),
});

const updateInspectionDraftSchema = z.object({
  conductedAt: dateSchema.optional(),
  zones: z.array(inspectionZoneSchema).min(1, 'Au moins une zone requise'),
  generalNotes: optionalText(2000),
});

// Sortie : mêmes champs que l'entrée + les retenues libres (arriérés,
// factures...), distinctes de la grille de dégradations par élément.
const updateMoveOutDraftSchema = updateInspectionDraftSchema.extend({
  otherDeductionsAmount: amountSchema.default(0),
  otherDeductionsNote: optionalText(255),
});

module.exports = {
  keySchema,
  startInspectionReportSchema,
  updateInspectionDraftSchema,
  updateMoveOutDraftSchema,
};
