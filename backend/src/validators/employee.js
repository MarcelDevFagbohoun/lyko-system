'use strict';

const { z } = require('zod');
const { phoneSchema, nameSchema } = require('./auth');
const { PERMISSION_KEYS } = require('../constants/permissions');

const permissionsSchema = z.array(z.enum(PERMISSION_KEYS)).default([]);

// Email optionnel : chaîne vide traitée comme absence d'email (null en base).
// Bug corrigé (trouvé en vérifiant « Biens à vendre », 2026-10-18) : le commentaire de
// `updateEmployeeSchema` ci-dessous documentait depuis le début que `null` devait pouvoir effacer
// l'email, mais ce schéma n'acceptait jamais `null` — seulement `undefined` ou `''`. Le frontend
// (`editer-view.tsx`) envoie pourtant bien `email: null` quand le champ est vide, ce qui faisait
// échouer TOUTE sauvegarde sur la fiche d'un employé sans email (le cas courant), pas seulement un
// changement d'email — y compris l'attribution d'une permission. `.nullable()` ajouté.
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email invalide')
  .optional()
  .nullable()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

// Rôle attribuable à un employé (le DG ne se crée pas via cet écran : voir étape 2).
const employeeRoleSchema = z.enum(['comptable', 'agent'], {
  errorMap: () => ({ message: "Rôle invalide (comptable ou agent)" }),
});

const createEmployeeSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  // Numéro de contact (WhatsApp) : sert à transmettre les identifiants, plus à se connecter.
  phone: phoneSchema,
  email: emailSchema,
  role: employeeRoleSchema,
  permissions: permissionsSchema,
});

// Sémantique PATCH (mise à jour partielle) : `email` peut valoir undefined
// (clé absente → ne pas toucher), null (chaîne vide envoyée → effacer
// l'email) ou une adresse (la remplacer). Même logique pour `permissions`
// (undefined = ne pas toucher, [] envoyé explicitement = tout retirer).
const updateEmployeeSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  email: emailSchema.optional(),
  role: employeeRoleSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  permissions: permissionsSchema.optional(),
});

// Attribution de Biens à un agent (étape 14) : « ajouter un nombre donné de
// Biens à un agent pour la gestion » — un ou plusieurs à la fois, en un seul
// appel.
const assignPropertiesSchema = z.object({
  propertyIds: z.array(z.number().int().positive()).min(1, 'Sélectionnez au moins un Bien'),
});

module.exports = { createEmployeeSchema, updateEmployeeSchema, assignPropertiesSchema };
