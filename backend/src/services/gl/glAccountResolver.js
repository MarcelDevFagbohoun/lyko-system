'use strict';

const { GL_ACCOUNT_ROLES } = require('../../constants/glAccountRoles');
const { getOrCreateThirdParty } = require('./glThirdPartyService');
const { TREASURY_BY_PAYMENT_METHOD } = require('../../db/seedGeneralLedger');
const { ApiError } = require('../../middleware/error');

/** Bail → locataire (pour `TIERS_LOCATAIRE`). */
async function resolveRenterFromLease(conn, tenantId, leaseId) {
  const [rows] = await conn.query(
    `SELECT r.id, r.first_name, r.last_name
     FROM leases l JOIN renters r ON r.id = l.renter_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, `Bail introuvable pour la résolution comptable (id ${leaseId})`);
  return rows[0];
}

/** Bail → Bien → propriétaire (pour `TIERS_PROPRIETAIRE` et le taux de commission). */
async function resolveOwnerFromLease(conn, tenantId, leaseId) {
  const [rows] = await conn.query(
    `SELECT o.id, o.name
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN owners o ON o.id = p.owner_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, `Propriétaire introuvable pour la résolution comptable (bail ${leaseId})`);
  return rows[0];
}

/**
 * Fournisseur → tiers (pour `TIERS_FOURNISSEUR`, compte auxiliaire 401 par
 * défaut). `controlAccountCode` (optionnel, ex. '481') force un sous-compte
 * SÉPARÉ pour le même fournisseur réel — une dette d'exploitation (401) et
 * une dette d'investissement (481) ne sont jamais le même compte, même
 * envers le même fournisseur (voir TIERS_FOURNISSEUR_INVESTISSEMENT).
 */
async function resolveSupplierThirdParty(conn, tenantId, supplierId, controlAccountCode) {
  const [rows] = await conn.query('SELECT id, name FROM suppliers WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: supplierId,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, `Fournisseur introuvable (id ${supplierId})`);

  let controlAccountId;
  if (controlAccountCode) {
    const [accountRows] = await conn.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
      tenantId,
      code: controlAccountCode,
    });
    if (!accountRows[0]) throw new ApiError(404, `Compte ${controlAccountCode} introuvable — plan comptable initialisé ?`);
    controlAccountId = accountRows[0].id;
  }

  return getOrCreateThirdParty(conn, {
    tenantId,
    partyType: 'supplier',
    sourceTable: 'suppliers',
    sourceId: rows[0].id,
    displayName: rows[0].name,
    controlAccountId,
  });
}

/** Compte de trésorerie réel pour un mode de paiement donné (pour `TRESORERIE_MODE_PAIEMENT`). */
async function resolveTreasuryAccountId(conn, tenantId, paymentMethod) {
  const mapping = TREASURY_BY_PAYMENT_METHOD[paymentMethod];
  if (!mapping) throw new ApiError(400, `Mode de paiement non pris en charge par le plan comptable : ${paymentMethod}`);
  const [rows] = await conn.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
    tenantId,
    code: mapping.account,
  });
  if (!rows[0]) throw new ApiError(404, `Compte de trésorerie ${mapping.account} introuvable — plan comptable initialisé ?`);
  return rows[0].id;
}

/**
 * Taux de commission applicable À UNE DATE DONNÉE (`atDate`, obligatoire —
 * voir `context.entryDate` injecté par `genererEcriture`). Sans ceci, un
 * rattrapage rétroactif d'anciens paiements (activation tardive du module,
 * voir `glActivationService`) appliquerait le taux ACTUEL à des paiements
 * bien antérieurs à son entrée en vigueur si le propriétaire a changé de
 * taux entre-temps — historique faux. `null` si aucun taux ne couvrait
 * encore cette date — le moteur traite alors la commission comme 0 % (tout
 * part au propriétaire, aucune ligne produit) plutôt que d'échouer : un
 * cabinet peut très bien gérer un bien sans commission (cas rare, valide).
 */
async function resolveCommissionRate(conn, tenantId, ownerId, atDate) {
  const [rows] = await conn.query(
    `SELECT rate FROM owner_commission_rates
     WHERE tenant_id = :tenantId AND owner_id = :ownerId
       AND starts_on <= :atDate AND (ends_on IS NULL OR ends_on > :atDate)
     ORDER BY starts_on DESC LIMIT 1`,
    { tenantId, ownerId, atDate },
  );
  return rows[0] ? Number(rows[0].rate) : 0;
}

/**
 * % d'une charge SONEB/SBEE encaissée répercuté intégralement au locataire
 * (411) plutôt que gardé par le cabinet comme frais de gestion (706) —
 * réglage par entreprise (`tenants.gl_utility_passthrough_percent`),
 * jamais par date ni par propriétaire (contrairement à la commission) :
 * un seul taux, celui EN VIGUEUR au moment de l'appel. Défaut 100 (aucune
 * part gardée) si jamais défini.
 */
async function resolveUtilityPassThroughPercent(conn, tenantId) {
  const [rows] = await conn.query('SELECT gl_utility_passthrough_percent FROM tenants WHERE id = :tenantId LIMIT 1', {
    tenantId,
  });
  return rows[0] ? Number(rows[0].gl_utility_passthrough_percent) : 100;
}

/**
 * Moment où la commission du cabinet doit être comptabilisée en produit —
 * réglage par entreprise (`tenants.gl_commission_timing`). 'encaissement'
 * (défaut, comportement historique) : constatée dès le loyer encaissé.
 * 'reversement' : reportée au reversement effectif au propriétaire.
 */
async function resolveCommissionTiming(conn, tenantId) {
  const [rows] = await conn.query('SELECT gl_commission_timing FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  return rows[0]?.gl_commission_timing ?? 'encaissement';
}

/**
 * Taux de retenue IRF (%) — réglage par entreprise (`tenants.gl_irf_enabled`/
 * `gl_irf_rate`, hypothèse #10, À VALIDER). Renvoie 0 si désactivé, même si
 * un taux non nul est enregistré (activer/désactiver sans perdre le taux déjà
 * saisi — même principe que `owner_commission_rates` conservé même à 0%).
 */
async function resolveIrfRate(conn, tenantId) {
  const [rows] = await conn.query('SELECT gl_irf_enabled, gl_irf_rate FROM tenants WHERE id = :tenantId LIMIT 1', {
    tenantId,
  });
  if (!rows[0] || !rows[0].gl_irf_enabled) return 0;
  return Number(rows[0].gl_irf_rate);
}

/**
 * Calcule EN UNE SEULE FOIS les deux retenues appliquées à un reversement
 * propriétaire (commission différée + IRF) — jamais recalculées séparément
 * pour chaque ligne : la ligne trésorerie (`retenues_reversement`) doit
 * correspondre EXACTEMENT à la somme des lignes 706/442 déjà arrondies
 * individuellement, sinon l'écriture ne s'équilibrerait plus au centime.
 */
async function computeReversementDeductions(conn, tenantId, context, totalAmount) {
  const timing = await resolveCommissionTiming(conn, tenantId);
  let commissionAmount = 0;
  if (timing === 'reversement') {
    const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId)).id;
    const rate = await resolveCommissionRate(conn, tenantId, ownerId, context.entryDate);
    commissionAmount = Math.round((totalAmount * rate) / 100);
  }
  const irfRate = await resolveIrfRate(conn, tenantId);
  const irfAmount = Math.round((totalAmount * irfRate) / 100);
  return { commissionAmount, irfAmount };
}

/** Compte (id) + tiers (id ou null) réels pour une ligne de règle donnée. */
async function resolveLineAccount(conn, { tenantId, line, context }) {
  // Cas particulier : `account_id` FIXE (165) mais un TIERS doit tout de même
  // être attaché, sous CE compte précis — pas le compte auxiliaire habituel
  // du locataire (411). Doit être vérifié AVANT le retour anticipé ci-dessous
  // (qui ignorerait sinon totalement le rôle).
  if (line.account_role === GL_ACCOUNT_ROLES.TIERS_LOCATAIRE_CAUTION) {
    const renter = await resolveRenterFromLease(conn, tenantId, context.leaseId);
    const thirdParty = await getOrCreateThirdParty(conn, {
      tenantId,
      partyType: 'renter',
      sourceTable: 'renters',
      sourceId: renter.id,
      displayName: `${renter.first_name} ${renter.last_name}`,
      controlAccountId: line.account_id,
    });
    return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
  }

  if (line.account_id) {
    return { accountId: line.account_id, thirdPartyId: null };
  }

  switch (line.account_role) {
    case GL_ACCOUNT_ROLES.TRESORERIE_MODE_PAIEMENT: {
      const accountId = await resolveTreasuryAccountId(conn, tenantId, context.paymentMethod);
      return { accountId, thirdPartyId: null };
    }
    case GL_ACCOUNT_ROLES.TIERS_FOURNISSEUR: {
      const thirdParty = await resolveSupplierThirdParty(conn, tenantId, context.supplierId);
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    // Dynamique : une dépense réglée immédiatement (paymentMethod fourni) va
    // en trésorerie comme avant ; une dépense "à crédit" (aucun paymentMethod,
    // un supplierId à la place) va au compte auxiliaire du fournisseur (401).
    case GL_ACCOUNT_ROLES.TRESORERIE_OU_FOURNISSEUR: {
      if (context.paymentMethod) {
        const accountId = await resolveTreasuryAccountId(conn, tenantId, context.paymentMethod);
        return { accountId, thirdPartyId: null };
      }
      const thirdParty = await resolveSupplierThirdParty(conn, tenantId, context.supplierId);
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    case GL_ACCOUNT_ROLES.TIERS_FOURNISSEUR_INVESTISSEMENT: {
      const thirdParty = await resolveSupplierThirdParty(conn, tenantId, context.supplierId, '481');
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    // Variante investissement de TRESORERIE_OU_FOURNISSEUR : 481 au lieu de
    // 401 quand l'achat d'immobilisation est "à crédit".
    case GL_ACCOUNT_ROLES.TRESORERIE_OU_FOURNISSEUR_INVESTISSEMENT: {
      if (context.paymentMethod) {
        const accountId = await resolveTreasuryAccountId(conn, tenantId, context.paymentMethod);
        return { accountId, thirdPartyId: null };
      }
      const thirdParty = await resolveSupplierThirdParty(conn, tenantId, context.supplierId, '481');
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    case GL_ACCOUNT_ROLES.TIERS_LOCATAIRE: {
      const renter = await resolveRenterFromLease(conn, tenantId, context.leaseId);
      const thirdParty = await getOrCreateThirdParty(conn, {
        tenantId,
        partyType: 'renter',
        sourceTable: 'renters',
        sourceId: renter.id,
        displayName: `${renter.first_name} ${renter.last_name}`,
      });
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    case GL_ACCOUNT_ROLES.TIERS_PROPRIETAIRE: {
      const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId)).id;
      const [ownerRows] = await conn.query('SELECT id, name FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: ownerId,
        tenantId,
      });
      if (!ownerRows[0]) throw new ApiError(404, `Propriétaire introuvable (id ${ownerId})`);
      const thirdParty = await getOrCreateThirdParty(conn, {
        tenantId,
        partyType: 'owner',
        sourceTable: 'owners',
        sourceId: ownerRows[0].id,
        displayName: ownerRows[0].name,
      });
      return { accountId: thirdParty.control_account_id, thirdPartyId: thirdParty.id };
    }
    default:
      throw new Error(`account_role inconnu dans une règle comptable : ${line.account_role}`);
  }
}

/**
 * Montant réel d'une ligne — jamais négatif ni nul en sortie (une ligne à
 * 0 est OMISE par l'appelant, voir glPostingService : un taux de commission
 * de 0 % ne doit pas produire une ligne "706" vide, interdite par la
 * contrainte `amount > 0`).
 */
async function resolveLineAmount(conn, { tenantId, line, totalAmount, context }) {
  switch (line.amount_formula) {
    case 'montant_total':
      return totalAmount;
    case 'montant_fixe':
      return Number(line.fixed_amount);
    case 'pourcentage_variable':
    case 'montant_moins_pourcentage': {
      if (line.formula_param === 'taux_repercussion_charge') {
        const rate = await resolveUtilityPassThroughPercent(conn, tenantId);
        const passedThrough = Math.round((totalAmount * rate) / 100);
        return line.amount_formula === 'pourcentage_variable' ? passedThrough : totalAmount - passedThrough;
      }
      // `taux_commission_encaissement` (loyer_encaisse UNIQUEMENT) : ne
      // s'applique QUE si gl_commission_timing = 'encaissement', sinon 0
      // (ligne omise) — voir le commentaire de `loyer_encaisse` dans
      // seedGeneralLedger.js. Indépendant de l'IRF (jamais retenu à
      // l'encaissement, seulement au reversement — voir plus bas).
      if (line.formula_param === 'taux_commission_encaissement') {
        const timing = await resolveCommissionTiming(conn, tenantId);
        let rate = 0;
        if (timing === 'encaissement') {
          const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId)).id;
          rate = await resolveCommissionRate(conn, tenantId, ownerId, context.entryDate);
        }
        const commission = Math.round((totalAmount * rate) / 100);
        return line.amount_formula === 'pourcentage_variable' ? commission : totalAmount - commission;
      }
      // `taux_commission_reversement` / `taux_irf` / `retenues_reversement`
      // (reversement_proprietaire UNIQUEMENT) : dérivées de LA MÊME fonction
      // partagée (`computeReversementDeductions`) pour garantir que la ligne
      // trésorerie (retenues_reversement = somme des deux autres) reste
      // TOUJOURS exactement égale à leurs montants déjà arrondis — jamais un
      // pourcentage combiné recalculé séparément, qui risquerait un écart
      // d'arrondi et une écriture déséquilibrée.
      if (['taux_commission_reversement', 'taux_irf', 'retenues_reversement'].includes(line.formula_param)) {
        const { commissionAmount, irfAmount } = await computeReversementDeductions(conn, tenantId, context, totalAmount);
        const amount =
          line.formula_param === 'taux_commission_reversement'
            ? commissionAmount
            : line.formula_param === 'taux_irf'
              ? irfAmount
              : commissionAmount + irfAmount;
        return line.amount_formula === 'pourcentage_variable' ? amount : totalAmount - amount;
      }
      throw new Error(`Paramètre de formule non pris en charge : ${line.formula_param}`);
    }
    default:
      throw new Error(`amount_formula inconnue : ${line.amount_formula}`);
  }
}

module.exports = {
  resolveRenterFromLease,
  resolveOwnerFromLease,
  resolveSupplierThirdParty,
  resolveCommissionRate,
  resolveUtilityPassThroughPercent,
  resolveCommissionTiming,
  resolveIrfRate,
  computeReversementDeductions,
  resolveLineAccount,
  resolveLineAmount,
};
