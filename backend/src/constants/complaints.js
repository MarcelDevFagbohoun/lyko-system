'use strict';

/** Catégorie d'une plainte/réclamation (section 7). */
const COMPLAINT_CATEGORIES = [
  { key: 'plomberie', label: 'Plomberie' },
  { key: 'electricite', label: 'Électricité' },
  { key: 'serrurerie', label: 'Serrurerie' },
  { key: 'climatisation', label: 'Climatisation' },
  { key: 'maconnerie', label: 'Maçonnerie / structure' },
  { key: 'autre', label: 'Autre' },
];
const COMPLAINT_CATEGORY_KEYS = COMPLAINT_CATEGORIES.map((c) => c.key);

const COMPLAINT_PRIORITIES = ['normale', 'urgente'];
const COMPLAINT_PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente' };

// ouverte → en_cours → resolue → fermee (fermee = clôturée après vérification,
// resolue = travaux/réponse apportés mais dossier pas encore clos).
const COMPLAINT_STATUSES = ['ouverte', 'en_cours', 'resolue', 'fermee'];
const COMPLAINT_STATUS_LABELS = {
  ouverte: 'Ouverte',
  en_cours: 'En cours',
  resolue: 'Résolue',
  fermee: 'Fermée',
};

const MAX_PHOTOS_PER_COMPLAINT = 4;

module.exports = {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_KEYS,
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
  MAX_PHOTOS_PER_COMPLAINT,
};
