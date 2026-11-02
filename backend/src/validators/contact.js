'use strict';

const { z } = require('zod');

/**
 * Formulaire de contact public (page d'accueil, aucun compte requis) — volontairement plus souple
 * que les validations internes (`validators/auth.js`) : un prospect peut écrire depuis n'importe quel
 * pays, pas seulement le Bénin, donc le téléphone n'est vérifié qu'en format large, pas en numérotation
 * béninoise stricte.
 */
const contactSchema = z.object({
  firstName: z.string().trim().min(1, 'Prénom requis').max(100),
  lastName: z.string().trim().min(1, 'Nom requis').max(100),
  // Optionnel (demande utilisateur : « si possible ») — chaîne vide traitée comme absente.
  companyName: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((v) => (v ? v : undefined)),
  phone: z
    .string()
    .trim()
    .min(6, 'Numéro de téléphone invalide')
    .max(30)
    .regex(/^[0-9+().\s-]+$/, 'Numéro de téléphone invalide'),
  subject: z.string().trim().min(1, 'Objet requis').max(150),
  description: z.string().trim().min(1, 'Message requis').max(4000),
  // Piège anti-spam (honeypot) : champ invisible pour un humain, rempli automatiquement par la
  // plupart des robots de soumission de formulaires — jamais affiché ni requis.
  website: z.string().max(0, '').optional().or(z.literal('')),
});

module.exports = { contactSchema };
