'use strict';

const COMPLAINT_PRIORITIES = ['normale', 'urgente'];
const COMPLAINT_PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente' };

// Deux statuts seulement (demande utilisateur, 2026-10-28) : une plainte est
// soit non résolue, soit résolue — plus d'étapes intermédiaires.
const COMPLAINT_STATUSES = ['non_resolue', 'resolue'];
const COMPLAINT_STATUS_LABELS = {
  non_resolue: 'Non résolue',
  resolue: 'Résolue',
};

const MAX_PHOTOS_PER_COMPLAINT = 4;

module.exports = {
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
  MAX_PHOTOS_PER_COMPLAINT,
};
