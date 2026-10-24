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

/**
 * Bail → Bien → propriétaire EN VIGUEUR À `atDate` (pour `TIERS_PROPRIETAIRE` et le taux de
 * commission) — PAS forcément le propriétaire ACTUEL du Bien. Bug corrigé (audit comptabilité
 * avancée) : ce moteur joignait directement `properties.owner_id` (propriétaire actuel), alors que
 * `services/commission.js` (`resolveOwnerAtDate`, étape 51bis) avait déjà corrigé ce même calcul
 * pour la comptabilité simple via `property_owner_history` (migration 078). Un Bien réattribué
 * entre-temps faisait donc imputer, dans LE GRAND LIVRE lui-même, tout paiement antérieur au
 * NOUVEAU propriétaire (compte 4671 et taux de commission) — y compris lors du rattrapage
 * rétroactif à l'activation du module (`glActivationService`). `atDate` est obligatoire : chaque
 * appelant doit le fournir explicitement (voir `context.entryDate`, injecté par `genererEcriture`)
 * plutôt que de pouvoir l'omettre en silence et retomber sur le mauvais comportement.
 */
async function resolveOwnerFromLease(conn, tenantId, leaseId, atDate) {
  if (!atDate) throw new Error('resolveOwnerFromLease : atDate requis (propriétaire EN VIGUEUR à cette date, jamais le propriétaire actuel par défaut)');
  const [rows] = await conn.query(
    `SELECT COALESCE(poh.owner_id, p.owner_id) AS id, o.name
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     LEFT JOIN property_owner_history poh ON poh.property_id = p.id
       AND poh.starts_on <= :atDate AND (poh.ends_on IS NULL OR poh.ends_on > :atDate)
     JOIN owners o ON o.id = COALESCE(poh.owner_id, p.owner_id)
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId, atDate },
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
  // Le compte Mobile Money est renommable : résolu par system_key, repli sur le code d'origine.
  const [rows] = mapping.account === '552'
    ? await conn.query(
        "SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND (system_key = 'mobile_money_account' OR code = '552') ORDER BY (system_key IS NULL) ASC LIMIT 1",
        { tenantId },
      )
    : await conn.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
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
  // Bug corrigé (audit sécurité/logique) : `ends_on` est écrit comme le
  // DERNIER JOUR INCLUS de validité de l'ancien taux (owners.js, à la
  // création d'un nouveau taux : `ends_on = starts_on du nouveau − 1 jour`).
  // La comparaison stricte `>` excluait donc CE jour-là de l'ancien taux
  // sans que le nouveau (dont `starts_on` est le lendemain) ne le couvre
  // non plus — un jour « orphelin » tombait silencieusement à 0 % de
  // commission dans le grand livre. `services/commission.js`
  // (`pickRateValidAt`/tableau de bord/garde-fou de versement) utilise déjà
  // `>=`, la même comparaison inclusive — ce moteur GL doit s'y aligner
  // pour ne jamais diverger de la commission réellement due ce jour-là.
  const [rows] = await conn.query(
    `SELECT rate FROM owner_commission_rates
     WHERE tenant_id = :tenantId AND owner_id = :ownerId
       AND starts_on <= :atDate AND (ends_on IS NULL OR ends_on >= :atDate)
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
    const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId, context.entryDate)).id;
    const rate = await resolveCommissionRate(conn, tenantId, ownerId, context.entryDate);
    commissionAmount = Math.round((totalAmount * rate) / 100);
  }
  const irfRate = await resolveIrfRate(conn, tenantId);
  let irfBase = totalAmount;
  if (irfRate > 0) {
    const [[t]] = await conn.query('SELECT gl_irf_base FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
    // Option « loyer brut » : à l'encaissement-commission, le versement est déjà net de commission ; le loyer
    // brut correspondant est reconstitué (versement ÷ (1 − commission)). Au reversement-commission, le
    // versement EST le brut. L'IRF ne dépasse jamais ce qui reste après commission.
    if (t?.gl_irf_base === 'loyer_brut' && timing === 'encaissement') {
      const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId, context.entryDate)).id;
      const rate = await resolveCommissionRate(conn, tenantId, ownerId, context.entryDate);
      if (rate > 0 && rate < 100) irfBase = Math.round(totalAmount / (1 - rate / 100));
    }
  }
  const irfAmount = Math.min(Math.round((irfBase * irfRate) / 100), totalAmount - commissionAmount);
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
      const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId, context.entryDate)).id;
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
      // Paie détaillée : montants déjà calculés (services/payroll.js) et transmis par le contexte.
      if (line.formula_param && line.formula_param.startsWith('paie_')) {
        const p = context.payroll;
        if (!p) throw new Error("Contexte manquant : payroll requis pour la paie détaillée");
        const map = {
          paie_charge_salaire: p.salaryCost,
          paie_cnss_patronale: p.cnssEmployer,
          paie_cnss_totale: p.cnssEmployee + p.cnssEmployer,
          paie_its: p.its,
        };
        if (!(line.formula_param in map)) throw new Error(`Paramètre de paie inconnu : ${line.formula_param}`);
        return map[line.formula_param];
      }
      if (line.formula_param === 'prix_cession') {
        const price = Number(context.salePrice ?? 0);
        return line.amount_formula === 'pourcentage_variable' ? price : totalAmount - price;
      }
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
          const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId, context.entryDate)).id;
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
      // `amortissement_cumule` (sortie d'immobilisation UNIQUEMENT, étape
      // « audit comptable » du 30/09/2026) : `totalAmount` porte le coût
      // d'ACQUISITION brut (crédité en totalité sur le compte 2xxx, qui doit
      // repasser à zéro pour ce bien) ; l'amortissement déjà pratiqué (somme
      // réelle de `fixed_asset_depreciations`, jamais recalculé) solde le
      // compte 28xxx (amortissement cumulé) ; le reste — la valeur nette
      // comptable résiduelle — part en charge (654).
      if (line.formula_param === 'amortissement_cumule') {
        const fixedAssetId = context.fixedAssetId;
        if (!fixedAssetId) throw new Error("Contexte manquant : fixedAssetId requis pour la formule 'amortissement_cumule'");
        const [[row]] = await conn.query(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM fixed_asset_depreciations WHERE fixed_asset_id = :fixedAssetId',
          { fixedAssetId },
        );
        const accumulated = Number(row.total);
        return line.amount_formula === 'pourcentage_variable' ? accumulated : totalAmount - accumulated;
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
