'use strict';

/** Type de bâtiment (Bien). */
const PROPERTY_TYPES = [
  { key: 'villa', label: 'Villa' },
  { key: 'duplex', label: 'Duplex' },
  { key: 'immeuble', label: 'Immeuble' },
  { key: 'maison_simple', label: 'Maison simple' },
  { key: 'autre', label: 'Autre' },
];
const PROPERTY_TYPE_KEYS = PROPERTY_TYPES.map((t) => t.key);

/** Désignation standardisée d'une Unité locative (évite les doublons de formulation). */
const UNIT_DESIGNATIONS = [
  { key: 'studio', label: 'Studio' },
  { key: 'chambre_salon', label: 'Chambre salon' },
  { key: 'chambre_salon_sanitaire_cuisine', label: 'Chambre salon + sanitaire + cuisine' },
  { key: 'appartement_2ch', label: 'Appartement 2 chambres salon + cuisine + douche' },
  { key: 'appartement_3ch', label: 'Appartement 3 chambres salon + SDB + cuisine' },
  { key: 'autre', label: 'Autre' },
];
const UNIT_DESIGNATION_KEYS = UNIT_DESIGNATIONS.map((d) => d.key);

const UNIT_STATUSES = ['libre', 'loue', 'reserve'];
const UNIT_STATUS_LABELS = { libre: 'Libre', loue: 'Loué', reserve: 'Réservé' };

const MAX_PHOTOS_PER_PROPERTY = 5;

module.exports = {
  PROPERTY_TYPES,
  PROPERTY_TYPE_KEYS,
  UNIT_DESIGNATIONS,
  UNIT_DESIGNATION_KEYS,
  UNIT_STATUSES,
  UNIT_STATUS_LABELS,
  MAX_PHOTOS_PER_PROPERTY,
};
