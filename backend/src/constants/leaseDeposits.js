'use strict';

/**
 * Cautions supplémentaires (étape 43) — distinctes de la caution de loyer, déjà existante
 * (`leases.deposit_amount`, jamais touchée par cette liste). Chacune : optionnelle, activable
 * indépendamment par entreprise (`tenants.deposit_{type}_enabled`), toujours une saisie manuelle du
 * montant (aucun montant suggéré — décision explicite de l'utilisateur).
 */
const ADDITIONAL_DEPOSIT_TYPES = [
  { key: 'sbee', label: 'Caution SBEE (électricité)', enabledColumn: 'deposit_sbee_enabled' },
  { key: 'soneb', label: 'Caution SONEB (eau)', enabledColumn: 'deposit_soneb_enabled' },
  { key: 'peinture', label: 'Caution peinture', enabledColumn: 'deposit_peinture_enabled' },
];
const ADDITIONAL_DEPOSIT_TYPE_KEYS = ADDITIONAL_DEPOSIT_TYPES.map((t) => t.key);
const ADDITIONAL_DEPOSIT_LABELS = Object.fromEntries(ADDITIONAL_DEPOSIT_TYPES.map((t) => [t.key, t.label]));

/** Types que CETTE entreprise a activés — à partir d'une ligne `tenants` (ou d'un sous-ensemble de ses colonnes). */
function enabledAdditionalDepositTypes(tenantRow) {
  return ADDITIONAL_DEPOSIT_TYPES.filter((t) => !!tenantRow[t.enabledColumn]);
}

module.exports = {
  ADDITIONAL_DEPOSIT_TYPES,
  ADDITIONAL_DEPOSIT_TYPE_KEYS,
  ADDITIONAL_DEPOSIT_LABELS,
  enabledAdditionalDepositTypes,
};
