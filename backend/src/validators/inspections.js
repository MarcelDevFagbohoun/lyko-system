'use strict';

const { z } = require('zod');
const { optionalText, dateSchema, amountSchema } = require('./renters');
const { INSPECTION_CONDITIONS } = require('../constants/inspection');

// Identifiant de zone/élément (stable ou généré côté client pour un ajout
// personnalisé) — jamais interpolé dans une requête SQL ou un chemin de
// fichier, mais borné par prudence.
const keySchema = z.string().trim().regex(/^[a-z0-9_-]{1,80}$/i, 'Identifiant invalide');

// Une ligne de facturation choisie sur un élément dégradé : soit une entrée
// du catalogue (`catalogItemId` renseigné, prix repris — copié, jamais une
// référence vive, voir migration 056), soit un élément non catalogué saisi
// à la main (`catalogItemId` null). `quantity` couvre le cas de plusieurs
// dégâts identiques sur le même poste (ex. 2 vitres cassées).
const billingLineSchema = z.object({
  catalogItemId: z.coerce.number().int().positive().nullable().default(null),
  label: z.string().trim().min(1).max(150),
  unitPrice: amountSchema.refine((v) => v > 0, 'Le prix doit être supérieur à 0'),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
});

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
  // Jusqu'à 3 photos par élément (étape 48) — chemins déjà enregistrés par
  // POST .../photo, jamais fixés directement par le client à une valeur
  // arbitraire de son choix (voir la route : elle ignore ce champ pour
  // l'élément qu'elle vient de mettre à jour, elle ne fait qu'ajouter/retirer
  // une entrée du tableau).
  photoUrls: z.array(z.string().trim().max(500)).max(3).default([]),
  // Montant de retenue final. Si `billing.lines` est renseigné, ce montant
  // est RECALCULÉ côté serveur à partir des lignes (jamais celui envoyé par
  // le client) — voir `services/inspection.js` `computeItemDeduction`. Sans
  // ligne de facturation, reste le champ libre saisi à la main (comportement
  // historique, avant l'existence du catalogue).
  deduction: amountSchema.default(0),
  billing: z.object({ lines: z.array(billingLineSchema).max(20) }).nullable().default(null),
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
  // Caution peinture (étape 43) — même principe que les autres retenues ci-dessus, mais plafonnée
  // séparément à SA PROPRE caution (voir services/leaseDeposits.js `finalizeAdditionalDeposits`),
  // jamais mêlée à `otherDeductionsAmount` (caution de loyer).
  peintureDeductionAmount: amountSchema.default(0),
  peintureDeductionNote: optionalText(255),
});

// Réouverture d'une fiche finalisée (étape 48, DG uniquement) : motif
// obligatoire, tracé au journal d'activité (`services/activity.js`).
const reopenInspectionReportSchema = z.object({
  reason: z.string().trim().min(10, 'Motif trop court (10 caractères minimum)').max(2000),
});

module.exports = {
  keySchema,
  startInspectionReportSchema,
  updateInspectionDraftSchema,
  updateMoveOutDraftSchema,
  reopenInspectionReportSchema,
};
