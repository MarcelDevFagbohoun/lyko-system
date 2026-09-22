'use strict';

/**
 * Seed du plan comptable SYSCOHADA + journaux + règles comptables de départ,
 * POUR UNE ENTREPRISE (tenant) donnée. Idempotent (peut être rejoué sans
 * dupliquer) — utile aussi bien à l'activation initiale d'un tenant existant
 * qu'à la création d'un nouveau.
 *
 *   node src/db/seedGeneralLedger.js <tenantId>
 *
 * ⚠️ Plan comptable RÉDUIT au strict nécessaire pour un cabinet de gestion
 * immobilière en mandat (pas les ~400 comptes SYSCOHADA exhaustifs) — classe
 * 3 (stocks) volontairement absente (aucune pertinence pour ce métier).
 * PLUSIEURS choix ci-dessous sont des hypothèses de jugement comptable,
 * marquées `// À VALIDER` — voir aussi le document d'hypothèses livré à
 * part. `is_validated_by_accountant` démarre à 0 sur TOUTES les règles :
 * rien n'est présenté comme validé tant qu'un comptable ne l'a pas
 * explicitement fait depuis l'espace Comptabilité avancée.
 *
 * ⚠️ Exécuté uniquement sur des tenants jetables de test jusqu'ici — les
 * choix marqués `// À VALIDER` restent en attente d'un expert-comptable
 * avant tout seed sur KIko Store (production).
 */

const { pool, closePool } = require('../config/db');
const logger = require('../utils/logger');

// ────────────────────────────────────────────────────────────────────────
// 1. Plan comptable
// ────────────────────────────────────────────────────────────────────────
const ACCOUNTS = [
  // Classe 1 — Ressources durables
  { code: '101', label: 'Capital social', class: 1, type: 'passif' },
  { code: '121', label: "Résultat de l'exercice (bénéfice)", class: 1, type: 'passif' },
  { code: '129', label: "Résultat de l'exercice (perte)", class: 1, type: 'actif' },
  {
    code: '165',
    label: 'Dépôts et cautionnements reçus',
    class: 1,
    type: 'passif',
    control: true,
    note: 'Cautions locataires — compte de tiers (dette à restituer), jamais un produit.',
  },

  // Classe 2 — Immobilisations (matériel du cabinet lui-même — jamais les
  // biens gérés pour le compte des propriétaires, qui n'appartiennent pas au
  // cabinet). Réduit aux catégories plausibles pour une agence de gestion
  // locative (pas les ~40 comptes 2X exhaustifs) : informatique, mobilier,
  // véhicule. Chaque compte d'actif (24XX) est accompagné de son compte
  // d'amortissement miroir (284XX, classe 2 également — un compte
  // SOUSTRACTIF de l'actif, jamais une charge ni un passif).
  { code: '2442', label: 'Matériel informatique', class: 2, type: 'actif' },
  { code: '2444', label: 'Mobilier de bureau', class: 2, type: 'actif' },
  { code: '2451', label: 'Matériel de transport', class: 2, type: 'actif' },
  {
    code: '28442',
    label: 'Amortissements — Matériel informatique',
    class: 2,
    type: 'actif',
    note: 'Compte SOUSTRACTIF (vient en déduction de 2442 au bilan) — un solde créditeur, jamais une charge.',
  },
  {
    code: '28444',
    label: 'Amortissements — Mobilier de bureau',
    class: 2,
    type: 'actif',
    note: 'Compte SOUSTRACTIF (vient en déduction de 2444 au bilan) — un solde créditeur, jamais une charge.',
  },
  {
    code: '28451',
    label: 'Amortissements — Matériel de transport',
    class: 2,
    type: 'actif',
    note: 'Compte SOUSTRACTIF (vient en déduction de 2451 au bilan) — un solde créditeur, jamais une charge.',
  },

  // Classe 4 — Tiers
  { code: '401', label: 'Fournisseurs, dettes en compte', class: 4, type: 'passif', control: true },
  { code: '411', label: 'Clients (locataires)', class: 4, type: 'actif', control: true },
  { code: '421', label: 'Personnel, avances et acomptes', class: 4, type: 'actif', control: true },
  { code: '422', label: 'Personnel, rémunérations dues', class: 4, type: 'passif', control: true },
  { code: '431', label: 'Sécurité sociale (CNSS)', class: 4, type: 'passif' },
  {
    code: '442',
    label: 'État, impôts et taxes recouvrables sur des tiers',
    class: 4,
    type: 'passif',
    note: "IRF (Impôt sur le Revenu Foncier) retenu à la source sur le loyer avant reversement au propriétaire, en attente de reversement au fisc — voir `reversement_proprietaire` et `reglement_irf`. Compte mouvementé uniquement si `tenants.gl_irf_enabled` est activé (désactivé par défaut). Un seul débiteur (l'État), jamais de sous-compte par tiers, contrairement à 401/411/4671.",
  },
  {
    code: '4671',
    systemKey: 'owner_control_account',
    label: 'Propriétaires mandants — comptes courants',
    class: 4,
    type: 'passif',
    control: true,
    note: 'Numéro renommable par le DG (Comptabilité avancée → Réglages) une fois l\'avis de son expert-comptable obtenu — SYSCOHADA ne prévoit pas de compte officiel dédié au mandat de gestion locative (certains cabinets utilisent 4671, d\'autres un compte 46 "Associés").',
  },
  { code: '481', label: "Fournisseurs d'investissements", class: 4, type: 'passif', control: true },

  // Classe 5 — Trésorerie
  { code: '521', label: 'Banques locales', class: 5, type: 'actif' },
  { code: '571', label: 'Caisse siège social', class: 5, type: 'actif' },
  {
    code: '552',
    label: 'Mobile Money',
    class: 5,
    type: 'actif',
    note: 'À VALIDER — compte divisionnaire créé par extension (SYSCOHADA ne distingue pas le mobile money, norme antérieure à sa généralisation). Générique pour l\'instant (MTN/Moov/Celtiis non distingués car `payment_method` dans les tables existantes ne capture pas l\'opérateur) — voir hypothèse dédiée.',
  },

  // Classe 6 — Charges
  { code: '604', label: 'Achats de fournitures', class: 6, type: 'charge' },
  { code: '622', label: 'Locations et charges locatives (bureau)', class: 6, type: 'charge' },
  { code: '624', label: 'Entretien, réparations', class: 6, type: 'charge' },
  { code: '628', label: 'Transports', class: 6, type: 'charge' },
  { code: '6281', label: 'Communication (téléphone, internet)', class: 6, type: 'charge' },
  { code: '638', label: 'Autres charges externes (marketing)', class: 6, type: 'charge' },
  { code: '641', label: 'Impôts et taxes directs', class: 6, type: 'charge' },
  { code: '658', label: 'Charges diverses de gestion courante', class: 6, type: 'charge' },
  {
    code: '661',
    label: 'Rémunérations directes versées au personnel',
    class: 6,
    type: 'charge',
    note: 'À VALIDER — paie "nette simple" en V1, sans ventilation retenues CNSS/ITS (421/422/431 créés mais non mouvementés automatiquement).',
  },
  { code: '671', label: 'Intérêts des emprunts', class: 6, type: 'charge' },
  { code: '681', label: 'Dotations aux amortissements', class: 6, type: 'charge' },

  // Classe 7 — Produits
  {
    code: '706',
    label: 'Services vendus (honoraires de gérance)',
    class: 7,
    type: 'produit',
    note: 'Compte-clé : commission du cabinet sur les loyers encaissés pour le compte des propriétaires.',
  },
  {
    code: '707',
    systemKey: 'late_fee_income_account',
    label: 'Produits accessoires (pénalités de retard)',
    class: 7,
    type: 'produit',
    note: 'Numéro renommable par le DG (Comptabilité avancée → Réglages) une fois l\'avis de son expert-comptable obtenu — 758 "Produits divers" est une alternative courante.',
  },
  { code: '771', label: 'Intérêts et produits financiers', class: 7, type: 'produit' },
];

// ────────────────────────────────────────────────────────────────────────
// 2. Journaux
// ────────────────────────────────────────────────────────────────────────
const JOURNALS = [
  { code: 'CA', label: 'Journal de caisse' },
  { code: 'BQ', label: 'Journal de banque' },
  { code: 'MM', label: 'Journal mobile money' },
  { code: 'OD', label: 'Journal des opérations diverses' },
  { code: 'AN', label: 'Journal des à-nouveaux' },
];

// Résout le journal ET le compte de trésorerie à partir du `payment_method`
// déjà utilisé partout dans les tables EXISTANTES (rent_payments, expenses,
// owner_payouts, utility_payments) — jamais un nouveau champ à saisir.
const TREASURY_BY_PAYMENT_METHOD = {
  especes: { journal: 'CA', account: '571' },
  virement: { journal: 'BQ', account: '521' },
  cheque: { journal: 'BQ', account: '521' },
  mobile_money: { journal: 'MM', account: '552' },
  kkiapay: { journal: 'MM', account: '552' }, // À VALIDER — KKiaPay règle par Mobile Money/carte ; simplifié sur 552 en V1.
};

// ────────────────────────────────────────────────────────────────────────
// 3. Règles comptables de départ (10 à 15 opérations types)
// ────────────────────────────────────────────────────────────────────────
// `journal` ci-dessous est le journal PAR DÉFAUT de la règle (OD pour la
// plupart, car le vrai journal de trésorerie est déterminé dynamiquement
// via TREASURY_BY_PAYMENT_METHOD au moment de l'exécution — voir
// account_role: 'tresorerie_mode_paiement' dans les lignes).
const RULES = [
  {
    operation_type: 'loyer_encaisse',
    label: 'Encaisser un loyer',
    journal: 'OD',
    narration_template: 'Loyer {mois} — {locataire}',
    note:
      "HYPOTHÈSE MAJEURE À VALIDER : comptabilité de TRÉSORERIE (constatation au moment de l'encaissement effectif, pas à l'échéance) — cohérent avec le fonctionnement actuel de rent_payments (aucune notion de créance loyer avant paiement). Le MOMENT où la commission du cabinet est comptabilisée en produit (dès cet encaissement, ou seulement au reversement au propriétaire) est configurable par entreprise (tenants.gl_commission_timing, Comptabilité avancée → Règles comptables) — défaut 'encaissement', comportement historique inchangé. Voir aussi la règle `reversement_proprietaire`, symétrique.",
    lines: [
      { side: 'debit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
      { side: 'credit', account: '706', formula: 'pourcentage_variable', param: 'taux_commission_encaissement' },
      { side: 'credit', role: 'tiers_proprietaire', formula: 'montant_moins_pourcentage', param: 'taux_commission_encaissement' },
    ],
  },
  {
    operation_type: 'dette_initiale_encaissee',
    label: "Encaisser une dette locataire antérieure",
    journal: 'OD',
    narration_template: 'Dette initiale — {locataire}',
    note:
      "Règlement (total ou partiel) d'une dette locataire déjà due à la création du bail (onboarding d'une entreprise avec des locataires déjà en place — voir leases.opening_debt_amount). DÉCISION EXPLICITE DE L'UTILISATEUR : traitée exactement comme un encaissement de loyer normal, mêmes lignes que `loyer_encaisse` (même répartition commission/propriétaire, mêmes réglages gl_commission_timing) — une règle distincte seulement pour garder une narration/un journal d'audit séparés, jamais mélangés aux vrais loyers du mois.",
    lines: [
      { side: 'debit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
      { side: 'credit', account: '706', formula: 'pourcentage_variable', param: 'taux_commission_encaissement' },
      { side: 'credit', role: 'tiers_proprietaire', formula: 'montant_moins_pourcentage', param: 'taux_commission_encaissement' },
    ],
  },
  {
    operation_type: 'frais_agence_encaisse',
    label: "Encaisser des frais d'agence à l'entrée",
    journal: 'OD',
    narration_template: "Frais d'agence à l'entrée — {locataire}",
    note:
      "Frais pris DIRECTEMENT au locataire à la signature du bail (décision explicite de l'utilisateur) — 100 % produit du CABINET, jamais reversé et jamais compté dans la recette du propriétaire : contrairement à `loyer_encaisse`/`dette_initiale_encaissee`, aucune ligne `tiers_proprietaire` ici, tout part en 706 dès l'encaissement. Compte 706 réutilisé (déjà 'Services vendus — honoraires de gérance') plutôt qu'un nouveau compte dédié — à revoir avec l'expert-comptable si une distinction séparée s'avère utile au reporting.",
    lines: [
      { side: 'debit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
      { side: 'credit', account: '706', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'charge_locative_encaissee',
    label: 'Encaisser une charge SONEB/SBEE',
    journal: 'OD',
    narration_template: 'Charge {fluide} {periode} — {locataire}',
    note:
      "À VALIDER : même logique de trésorerie que le loyer (une seule écriture à l'encaissement effectif, pas de créance constatée à la facturation). Le % répercuté au 411 (comportement historique : 100 %, rien gardé) est configurable par entreprise (tenants.gl_utility_passthrough_percent, Comptabilité avancée → Règles comptables) — le reste part en 706 comme frais de gestion du cabinet.",
    lines: [
      { side: 'debit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
      { side: 'credit', role: 'tiers_locataire', formula: 'pourcentage_variable', param: 'taux_repercussion_charge' },
      { side: 'credit', account: '706', formula: 'montant_moins_pourcentage', param: 'taux_repercussion_charge' },
    ],
  },
  {
    operation_type: 'caution_recue',
    label: 'Encaisser une caution (dépôt de garantie)',
    journal: 'OD',
    narration_template: 'Caution reçue — {locataire}',
    lines: [
      { side: 'debit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
      // `account` fixe (165) ET `role` en même temps : le compte est connu à
      // l'avance, mais un TIERS (sous-compte par locataire) doit tout de
      // même être attaché — voir glAccountResolver.resolveLineAccount et le
      // cas TIERS_LOCATAIRE_CAUTION, distinct de TIERS_LOCATAIRE (qui, lui,
      // pointerait vers le compte 411 habituel, pas 165).
      { side: 'credit', account: '165', role: 'tiers_locataire_caution', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'caution_restituee',
    label: 'Restituer une caution',
    journal: 'OD',
    narration_template: 'Caution restituée — {locataire}',
    note:
      'Version SIMPLE (restitution intégrale). À VALIDER pour le cas avec retenue (dégâts constatés à l\'état des lieux de sortie, déjà calculé par le module Sorties de locataires existant) : la retenue est-elle un produit (707/758) ou une compensation de charge de remise en état ? Choix de jugement comptable à trancher avant d\'automatiser ce cas — non branché : voir routes/leases.js `move-out-report/finalize`.',
    lines: [
      { side: 'debit', account: '165', role: 'tiers_locataire_caution', formula: 'montant_total' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'reversement_proprietaire',
    label: 'Reverser à un propriétaire',
    journal: 'OD',
    narration_template: 'Reversement — {proprietaire}',
    note:
      "Symétrique de `loyer_encaisse` : si tenants.gl_commission_timing = 'reversement', la commission (706) est prélevée ICI plutôt qu'à l'encaissement. La retenue IRF (442, hypothèse #10 — À VALIDER) est TOUJOURS prélevée ici si `tenants.gl_irf_enabled` (jamais à l'encaissement : c'est le versement effectif au propriétaire qui déclenche la retenue à la source, pas la simple collecte du loyer par le cabinet). Avec les réglages par défaut (commission à l'encaissement, IRF désactivé), les lignes 706/442 valent 0 et sont omises : comportement historique inchangé (montant intégral versé).",
    lines: [
      { side: 'debit', role: 'tiers_proprietaire', formula: 'montant_total' },
      { side: 'credit', account: '706', formula: 'pourcentage_variable', param: 'taux_commission_reversement' },
      { side: 'credit', account: '442', formula: 'pourcentage_variable', param: 'taux_irf' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_moins_pourcentage', param: 'retenues_reversement' },
    ],
  },
  {
    operation_type: 'reglement_irf',
    label: "Reverser l'IRF retenu au fisc",
    journal: 'OD',
    narration_template: 'Règlement IRF — {periode}',
    note:
      "Solde tout ou partie du compte 442 (IRF retenu, en attente de reversement au fisc) — jamais une nouvelle charge, juste l'extinction d'une dette déjà constatée à chaque reversement propriétaire. À VALIDER : périodicité réelle de versement au fisc (mensuelle ? trimestrielle ?) laissée au choix du cabinet — cette écriture peut être saisie à tout rythme.",
    lines: [
      { side: 'debit', account: '442', formula: 'montant_total' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'salaire_paye',
    label: 'Payer un salaire',
    journal: 'OD',
    narration_template: 'Salaire {mois} — {employe}',
    note: 'À VALIDER — paie nette simple (pas de ventilation retenues CNSS/ITS en V1).',
    lines: [
      { side: 'debit', account: '661', formula: 'montant_total' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'penalite_retard',
    label: 'Appliquer une pénalité de retard',
    journal: 'OD',
    narration_template: 'Pénalité de retard — {locataire}',
    note: 'Optionnelle/paramétrable comme demandé — désactivable via is_active sans supprimer la règle.',
    lines: [
      { side: 'debit', role: 'tiers_locataire', formula: 'montant_total' },
      { side: 'credit', account: '707', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'reglement_fournisseur',
    label: 'Régler un fournisseur',
    journal: 'OD',
    narration_template: 'Règlement fournisseur — {fournisseur}',
    note:
      "Solde une dette fournisseur déjà engagée (une dépense enregistrée \"à crédit\", voir tresorerie_ou_fournisseur ci-dessous) — jamais une nouvelle charge, seulement un mouvement de trésorerie.",
    lines: [
      { side: 'debit', role: 'tiers_fournisseur', formula: 'montant_total' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
    ],
  },
  {
    operation_type: 'reglement_fournisseur_investissement',
    label: 'Régler un fournisseur d\'investissement',
    journal: 'OD',
    narration_template: 'Règlement fournisseur (investissement) — {fournisseur}',
    note: 'Variante de reglement_fournisseur pour une immobilisation achetée "à crédit" (compte 481, pas 401).',
    lines: [
      { side: 'debit', role: 'tiers_fournisseur_investissement', formula: 'montant_total' },
      { side: 'credit', role: 'tresorerie_mode_paiement', formula: 'montant_total' },
    ],
  },
  // Immobilisations du cabinet (matériel propre, jamais les biens gérés
  // pour compte de tiers) — une paire acquisition/amortissement par
  // catégorie, même principe que les dépenses par catégorie ci-dessous.
  // L'acquisition réutilise la même dynamique "trésorerie ou fournisseur"
  // que les dépenses à crédit, mais vers 481 (fournisseurs d'investissements)
  // plutôt que 401 — SYSCOHADA distingue les deux, jamais le même sous-compte.
  ...[
    { category: 'informatique', label: 'Matériel informatique', assetAccount: '2442', depreciationAccount: '28442' },
    { category: 'mobilier', label: 'Mobilier de bureau', assetAccount: '2444', depreciationAccount: '28444' },
    { category: 'transport', label: 'Matériel de transport', assetAccount: '2451', depreciationAccount: '28451' },
  ].flatMap((c) => [
    {
      operation_type: `immobilisation_${c.category}_acquise`,
      label: `Acquérir — ${c.label}`,
      journal: 'OD',
      narration_template: `Acquisition — ${c.label} — {libelle}`,
      lines: [
        { side: 'debit', account: c.assetAccount, formula: 'montant_total' },
        { side: 'credit', role: 'tresorerie_ou_fournisseur_investissement', formula: 'montant_total' },
      ],
    },
    {
      operation_type: `amortissement_${c.category}`,
      label: `Amortir — ${c.label}`,
      journal: 'OD',
      narration_template: `Dotation aux amortissements — ${c.label} — {libelle}`,
      note:
        "Amortissement LINÉAIRE simple (coût / durée de vie / 12). Le prorata temporis du mois d'acquisition est configurable par entreprise (désactivé par défaut, mois plein — voir tenants.gl_depreciation_prorata_temporis et glDepreciationService.js). Toujours une saisie MANUELLE (un clic par mois par immobilisation, jamais automatique) : le rythme réel de comptabilisation des amortissements est un choix du cabinet/de son comptable.",
      lines: [
        { side: 'debit', account: '681', formula: 'montant_total' },
        { side: 'credit', account: c.depreciationAccount, formula: 'montant_total' },
      ],
    },
  ]),
  // Dépenses de fonctionnement — une règle par catégorie EXISTANTE
  // (expenses.category), pour que chaque catégorie ait sa propre
  // correspondance modifiable indépendamment (jamais de compte en dur).
  { operation_type: 'depense_loyer_bureau', label: 'Dépense — Loyer du bureau', account: '622' },
  { operation_type: 'depense_fournitures', label: 'Dépense — Fournitures', account: '604' },
  { operation_type: 'depense_entretien', label: 'Dépense — Entretien', account: '624' },
  { operation_type: 'depense_transport', label: 'Dépense — Transport', account: '628' },
  { operation_type: 'depense_communication', label: 'Dépense — Communication', account: '6281' },
  { operation_type: 'depense_marketing', label: 'Dépense — Marketing', account: '638' },
  { operation_type: 'depense_taxes', label: 'Dépense — Taxes', account: '641' },
  { operation_type: 'depense_autre', label: 'Dépense — Autre', account: '658' },
].map((r) =>
  r.lines
    ? r
    : {
        // Génère les 2 lignes standard (débit charge / crédit trésorerie OU
        // fournisseur — voir TRESORERIE_OU_FOURNISSEUR, glAccountRoles.js)
        // pour chaque règle de dépense par catégorie ci-dessus. Une SEULE
        // règle couvre "réglée immédiatement" ET "à crédit" : le rôle
        // dynamique choisit selon que `context.paymentMethod` est fourni.
        ...r,
        journal: 'OD',
        narration_template: `${r.label} — {libelle}`,
        lines: [
          { side: 'debit', account: r.account, formula: 'montant_total' },
          { side: 'credit', role: 'tresorerie_ou_fournisseur', formula: 'montant_total' },
        ],
      },
);

// ────────────────────────────────────────────────────────────────────────
// Exécution
// ────────────────────────────────────────────────────────────────────────
async function seed(tenantId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Comptes — idempotent (INSERT ... ON DUPLICATE KEY UPDATE sur le libellé
    // uniquement, ne touche jamais is_system/is_active d'un compte déjà là).
    const accountIdByCode = new Map();
    for (const a of ACCOUNTS) {
      // `system_key` (ex. 'owner_control_account') identifie de façon STABLE
      // un compte dont le NUMÉRO fait débat entre cabinets comptables —
      // jamais réattribué même si le DG renomme `code` ensuite (voir
      // migration 050 et routes/gl/glAccounts.js `PATCH /renameable/:key`).
      const [result] = await conn.query(
        `INSERT INTO gl_accounts (tenant_id, code, system_key, label, class, account_type, is_control_account, is_system)
         VALUES (:tenantId, :code, :systemKey, :label, :class, :type, :control, 1)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        {
          tenantId,
          code: a.code,
          systemKey: a.systemKey ?? null,
          label: a.label,
          class: a.class,
          type: a.type,
          control: a.control ? 1 : 0,
        },
      );
      accountIdByCode.set(a.code, result.insertId);
    }

    // 2. Journaux
    const journalIdByCode = new Map();
    for (const j of JOURNALS) {
      const [result] = await conn.query(
        `INSERT INTO gl_journals (tenant_id, code, label, is_system)
         VALUES (:tenantId, :code, :label, 1)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        { tenantId, code: j.code, label: j.label },
      );
      journalIdByCode.set(j.code, result.insertId);
    }

    // 3. Règles + lignes — on repart de zéro pour les lignes à chaque seed
    // (les règles du seed ne sont jamais modifiées manuellement tant que
    // is_validated_by_accountant = 0 ; une fois validées, ce script ne doit
    // plus être rejoué sur ce tenant sans précaution — à documenter).
    for (const r of RULES) {
      const [ruleResult] = await conn.query(
        `INSERT INTO gl_posting_rules (tenant_id, operation_type, label, journal_id, narration_template, is_validated_by_accountant)
         VALUES (:tenantId, :operationType, :label, :journalId, :narration, 0)
         ON DUPLICATE KEY UPDATE label = VALUES(label), id = LAST_INSERT_ID(id)`,
        {
          tenantId,
          operationType: r.operation_type,
          label: r.label,
          journalId: journalIdByCode.get(r.journal),
          narration: r.narration_template,
        },
      );
      const ruleId = ruleResult.insertId;
      await conn.query('DELETE FROM gl_posting_rule_lines WHERE rule_id = :ruleId', { ruleId });
      for (const [i, line] of r.lines.entries()) {
        await conn.query(
          `INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
           VALUES (:ruleId, :order, :side, :accountId, :role, :formula, :param)`,
          {
            ruleId,
            order: i + 1,
            side: line.side,
            accountId: line.account ? accountIdByCode.get(line.account) : null,
            role: line.role ?? null,
            formula: line.formula,
            param: line.param ?? null,
          },
        );
      }
    }

    await conn.commit();
    logger.info('Plan comptable + journaux + règles initialisés', {
      tenantId,
      accounts: ACCOUNTS.length,
      journals: JOURNALS.length,
      rules: RULES.length,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Ajoute UNIQUEMENT les types d'opération du catalogue actuel qui n'ont
 * encore AUCUNE règle pour ce tenant — contrairement à `seed()` (qui
 * réécrit les lignes de TOUTES les règles à chaque appel, y compris celles
 * déjà là), celle-ci ne touche JAMAIS une règle existante, même si elle
 * n'est pas encore validée par un comptable. C'est le mécanisme sûr à
 * rejouer sur un tenant déjà actif en continu (ex. depuis un bouton
 * « Resynchroniser les règles », voir routes/gl/glPostingRules.js) — le
 * cas que ni `seed()` (risqué une fois des règles validées) ni la
 * réactivation après suspension (qui ne re-seed jamais, voir
 * `glActivationService.js`) ne couvrent : un module resté actif en continu
 * alors que de nouveaux types d'opération sont apparus depuis.
 *
 * Suppose que `seed()` a déjà tourné au moins une fois pour ce tenant
 * (comptes/journaux déjà en place) — lève une erreur explicite sinon.
 */
async function syncMissingPostingRules(tenantId) {
  const conn = await pool.getConnection();
  try {
    const [accountRows] = await conn.query('SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId', { tenantId });
    if (accountRows.length === 0) {
      throw new Error('Plan comptable non initialisé pour ce tenant — activez la comptabilité avancée avant de resynchroniser.');
    }
    const accountIdByCode = new Map(accountRows.map((a) => [a.code, a.id]));

    const [journalRows] = await conn.query('SELECT id, code FROM gl_journals WHERE tenant_id = :tenantId', { tenantId });
    const journalIdByCode = new Map(journalRows.map((j) => [j.code, j.id]));

    const [existingRuleRows] = await conn.query(
      'SELECT operation_type FROM gl_posting_rules WHERE tenant_id = :tenantId',
      { tenantId },
    );
    const existingTypes = new Set(existingRuleRows.map((r) => r.operation_type));
    const missingRules = RULES.filter((r) => !existingTypes.has(r.operation_type));
    if (missingRules.length === 0) return { added: [] };

    await conn.beginTransaction();
    for (const r of missingRules) {
      const [ruleResult] = await conn.query(
        `INSERT INTO gl_posting_rules (tenant_id, operation_type, label, journal_id, narration_template, is_validated_by_accountant)
         VALUES (:tenantId, :operationType, :label, :journalId, :narration, 0)`,
        {
          tenantId,
          operationType: r.operation_type,
          label: r.label,
          journalId: journalIdByCode.get(r.journal),
          narration: r.narration_template,
        },
      );
      const ruleId = ruleResult.insertId;
      for (const [i, line] of r.lines.entries()) {
        await conn.query(
          `INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
           VALUES (:ruleId, :order, :side, :accountId, :role, :formula, :param)`,
          {
            ruleId,
            order: i + 1,
            side: line.side,
            accountId: line.account ? accountIdByCode.get(line.account) : null,
            role: line.role ?? null,
            formula: line.formula,
            param: line.param ?? null,
          },
        );
      }
    }
    await conn.commit();
    logger.info('Règles comptables manquantes ajoutées', { tenantId, added: missingRules.map((r) => r.operation_type) });
    return { added: missingRules.map((r) => r.operation_type) };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Rattrape UNIQUEMENT le `system_key` d'un compte déjà existant (par `code`)
 * quand il est encore NULL — même défaut que `syncMissingPostingRules`, mais
 * sur `gl_accounts` plutôt que `gl_posting_rules` : `seed()` insère `system_key`
 * à la création d'un compte (`ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
 * un no-op sur conflit), donc un tenant déjà actif AVANT l'introduction d'un
 * `systemKey` sur un compte du catalogue (ex. 'owner_control_account' sur 4671,
 * migration 050) garde ce compte avec `system_key = NULL` pour toujours — et
 * `getOrCreateThirdParty`/`resolveLineAccount`, qui résolvent CE compte
 * uniquement par `system_key` (jamais par `code`, précisément pour survivre à
 * un renommage), échouent alors sur un tenant pourtant déjà actif. Ne touche
 * jamais un `system_key` déjà renseigné (idempotent, sans risque à rejouer).
 */
async function syncAccountSystemKeys(tenantId) {
  const conn = await pool.getConnection();
  try {
    const toBackfill = ACCOUNTS.filter((a) => a.systemKey);
    if (toBackfill.length === 0) return { updated: [] };

    const [rows] = await conn.query(
      'SELECT code, system_key FROM gl_accounts WHERE tenant_id = :tenantId AND code IN (:codes)',
      { tenantId, codes: toBackfill.map((a) => a.code) },
    );
    const systemKeyByCode = new Map(rows.map((r) => [r.code, r.system_key]));

    const updated = [];
    for (const a of toBackfill) {
      if (systemKeyByCode.has(a.code) && !systemKeyByCode.get(a.code)) {
        await conn.query('UPDATE gl_accounts SET system_key = :systemKey WHERE tenant_id = :tenantId AND code = :code', {
          systemKey: a.systemKey,
          tenantId,
          code: a.code,
        });
        updated.push(a.systemKey);
      }
    }
    if (updated.length > 0) {
      logger.info('system_key manquants rattrapés sur des comptes existants', { tenantId, updated });
    }
    return { updated };
  } finally {
    conn.release();
  }
}

async function main() {
  const tenantId = Number(process.argv[2]);
  if (!Number.isInteger(tenantId)) {
    process.stderr.write('Usage : node src/db/seedGeneralLedger.js <tenantId>\n');
    process.exitCode = 2;
    return;
  }
  try {
    await seed(tenantId);
  } catch (err) {
    logger.error('Échec du seed comptable', { error: err.message });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  seed,
  syncMissingPostingRules,
  syncAccountSystemKeys,
  ACCOUNTS,
  JOURNALS,
  RULES,
  TREASURY_BY_PAYMENT_METHOD,
};
