'use strict';

/**
 * Modèle par défaut du corps de l'attestation de loyer, utilisé tant que
 * l'entreprise n'a pas personnalisé son propre texte depuis les Paramètres.
 * Mêmes placeholders que ceux exposés au DG dans le formulaire.
 */
const DEFAULT_CONTRACT_TEMPLATE =
  "Je soussigné(e), {{signataire}}, représentant l'entreprise {{entreprise}} (RCCM {{rccm}}, IFU {{ifu}}), " +
  "atteste par la présente que {{locataire}}, joignable au {{telephone}}, est locataire du bien désigné " +
  '« {{bien}} », depuis le {{date_entree}}, moyennant un loyer mensuel de {{loyer}}.';

const CONTRACT_PLACEHOLDERS = [
  { key: 'locataire', label: 'Nom du locataire' },
  { key: 'telephone', label: 'Téléphone du locataire' },
  { key: 'bien', label: 'Désignation du bien (+ adresse)' },
  { key: 'date_entree', label: "Date d'entrée dans les lieux" },
  { key: 'loyer', label: 'Loyer mensuel (FCFA)' },
  { key: 'entreprise', label: "Nom de l'entreprise" },
  { key: 'rccm', label: 'RCCM' },
  { key: 'ifu', label: 'IFU' },
  { key: 'signataire', label: 'Nom du signataire (DG)' },
  { key: 'date', label: "Date du jour (ajoutée automatiquement)" },
];

/**
 * Remplace les {{placeholder}} par leur valeur ; laisse vide si inconnu.
 * Insensible à la casse ({{RCCM}}, {{Rccm}} et {{rccm}} sont équivalents) :
 * un contrat rédigé « à la main » écrit souvent ces jetons en majuscules
 * pour qu'ils ressortent visuellement dans le texte, sans que ce soit un
 * choix technique du DG à retenir.
 */
function renderContractTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key.toLowerCase()];
    return value !== undefined && value !== null ? String(value) : '';
  });
}

// Placeholders dont la valeur est un CHIFFRE (téléphone, RCCM/IFU, date,
// loyer) plutôt qu'un nom propre — rendus en Courier dans le PDF (refonte
// « factures professionnelles », services/pdf.js) au lieu du gras Helvetica
// utilisé pour les noms (locataire/entreprise/signataire/bien).
const MONO_PLACEHOLDER_KEYS = new Set(['telephone', 'rccm', 'ifu', 'date_entree', 'loyer', 'date']);

/**
 * Même substitution que `renderContractTemplate`, mais renvoie une liste de
 * segments `{ text, bold, mono }` au lieu d'une chaîne à plat : les valeurs
 * substituées (nom, RCCM, loyer…) ressortent du texte juridique fixe autour
 * — en gras pour un nom propre, en Courier (`mono`) pour un chiffre —
 * demandé par l'utilisateur. `services/pdf.js` les enchaîne avec l'API
 * « continued » de PDFKit pour garder un seul paragraphe qui se
 * justifie/retourne à la ligne normalement.
 */
function renderContractTemplateSegments(template, vars) {
  const segments = [];
  const regex = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: template.slice(lastIndex, match.index), bold: false });
    }
    const key = match[1].toLowerCase();
    const value = vars[key];
    const isMono = MONO_PLACEHOLDER_KEYS.has(key);
    segments.push({ text: value !== undefined && value !== null ? String(value) : '', bold: !isMono, mono: isMono });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < template.length) {
    segments.push({ text: template.slice(lastIndex), bold: false });
  }
  return segments;
}

module.exports = {
  DEFAULT_CONTRACT_TEMPLATE,
  CONTRACT_PLACEHOLDERS,
  renderContractTemplate,
  renderContractTemplateSegments,
};
