'use strict';

/**
 * Indicateur de séparation des fonds (dernier des 6 points de complétude
 * identifiés) — la trésorerie RÉELLE (521 banque + 571 caisse + 552 mobile
 * money, cumulée depuis toujours, jamais bornée à un exercice) doit
 * toujours pouvoir couvrir les fonds détenus pour le compte de TIERS : les
 * propriétaires mandants en attente de reversement (4671) et les cautions
 * locataires pas encore restituées (165). Si la trésorerie est inférieure à
 * ces fonds de tiers, le cabinet a utilisé de l'argent qui ne lui
 * appartient pas — signal de non-conformité.
 *
 * Exclut volontairement les dettes fournisseurs (401/481) : ce sont des
 * dettes COMMERCIALES ordinaires du cabinet (ses propres achats à crédit),
 * pas des fonds de tiers détenus en mandat. Exclut aussi 411 (locataires) :
 * sa sémantique pour les charges SONEB/SBEE reste une hypothèse déjà
 * flaguée et non validée (voir la note de la règle `charge_locative_encaissee`
 * dans seedGeneralLedger.js) — volontairement pas réutilisée ici tant
 * qu'elle n'est pas confirmée par l'expert-comptable.
 */
async function computeMandantsCabinetIndicator(pool, tenantId) {
  // Le compte propriétaires est identifié par `system_key` (migration 050),
  // JAMAIS par son `code` littéral — celui-ci est renommable par le DG
  // (4671 par défaut, mais peut devenir '46' ou autre) ; le filtrer par code
  // le ferait disparaître silencieusement de ce contrôle après un renommage.
  const [rows] = await pool.query(
    `SELECT a.code, a.system_key, COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_accounts a
     LEFT JOIN gl_entry_lines el ON el.account_id = a.id
     WHERE a.tenant_id = :tenantId
       AND (a.code IN ('521', '571', '552', '165') OR a.system_key = 'owner_control_account')
     GROUP BY a.id, a.code, a.system_key`,
    { tenantId },
  );
  const byCode = Object.fromEntries(rows.map((r) => [r.code, Number(r.solde)]));
  const ownerRow = rows.find((r) => r.system_key === 'owner_control_account');

  const treasury = {
    banque: byCode['521'] ?? 0,
    caisse: byCode['571'] ?? 0,
    mobileMoney: byCode['552'] ?? 0,
  };
  const treasuryTotal = treasury.banque + treasury.caisse + treasury.mobileMoney;
  // Comptes de PASSIF (crédit-heavy) : leur solde brut (débit − crédit) est
  // négatif quand un montant est dû — inversé ici pour afficher un montant
  // dû POSITIF, plus lisible.
  const dueToOwners = ownerRow ? -Number(ownerRow.solde) : 0;
  const depositsHeld = -(byCode['165'] ?? 0);
  const fundsHeldForThirdParties = dueToOwners + depositsHeld;

  return {
    treasury: { ...treasury, total: treasuryTotal },
    dueToOwners,
    depositsHeld,
    fundsHeldForThirdParties,
    coverage: treasuryTotal - fundsHeldForThirdParties,
  };
}

module.exports = { computeMandantsCabinetIndicator };
