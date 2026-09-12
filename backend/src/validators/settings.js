'use strict';

const { z } = require('zod');

// Chaîne vide envoyée volontairement = réinitialiser au modèle par défaut (NULL en base).
const updateSettingsSchema = z.object({
  // 50000 caractères : très large marge pour un contrat de bail complet
  // rédigé par N'IMPORTE QUELLE entreprise cliente, pas seulement le court
  // paragraphe d'attestation par défaut. La colonne est `MEDIUMTEXT`
  // (jusqu'à 16 Mo, migration 024) : cette limite est purement une garde-
  // fou raisonnable côté formulaire, jamais une contrainte technique de la
  // base qui pourrait resurgir plus tard.
  contractTemplate: z
    .string()
    .trim()
    .max(50000, 'Trop long (50 000 caractères max)')
    .optional()
    .or(z.literal(''))
    // Un texte collé depuis Word/Google Docs porte souvent des fins de ligne
    // "\r\n" : PDFKit les dessine comme un caractère visible (glyphe « Ð »)
    // au lieu d'un simple retour à la ligne. Normalisé dès l'enregistrement
    // pour que la valeur stockée soit déjà propre (en plus du filet de
    // sécurité côté génération PDF, `services/pdf.js`).
    .transform((v) => (v ? v.replace(/\r\n?/g, '\n') : null)),
});

module.exports = { updateSettingsSchema };
