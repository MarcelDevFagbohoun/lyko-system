'use strict';

/**
 * Modèle de texte du contrat de bail (demande directe de l'utilisateur, 2026-11-05 : « si je veux
 * changer le contenue du contrat » → le TEXTE des articles lui-même, pas seulement les données ; via
 * du texte libre avec des balises à remplir, « Recommandé »). Remplace la duplication historique du
 * libellé des articles (jusqu'ici codé en dur à la fois dans `pdf.js` `streamLeaseContractPdf` et dans
 * le composant frontend `ContractArticles`) par UN SEUL modèle, personnalisable par entreprise
 * (`tenants.lease_contract_template`), partagé par le PDF et l'aperçu web.
 *
 * Convention du modèle : chaque article commence par une ligne `## Titre de l'article` ; tout ce qui
 * suit (jusqu'au prochain `## ` ou la fin) est le corps, avec des balises `{{jeton}}` remplacées par
 * `renderContractTemplate`. Le numéro (« ARTICLE 1 », etc.) n'est PAS écrit dans le modèle : il est
 * recalculé automatiquement selon la position, pour rester cohérent même si des articles sont
 * réordonnés, ajoutés ou supprimés.
 *
 * Volontairement SANS aucune conditionnelle ni boucle côté modèle : chaque balise est une valeur déjà
 * composée (ex. `{{clause_caution}}` contient la phrase entière, vide si aucune caution) — ça évite
 * d'avoir à apprendre une syntaxe de gabarit, au prix d'une personnalisation limitée aux formulations,
 * jamais à la logique conditionnelle elle-même.
 *
 * L'article « Conditions particulières » (propre à CHAQUE bail, pas au modèle de l'entreprise) reste
 * géré séparément, exactement comme avant cette fonctionnalité — voir `leaseContractActions.js` et
 * `pdf.js` : il est ajouté après les articles du modèle, uniquement s'il y a du texte.
 *
 * Invariant essentiel (jamais dérogé) : un contrat déjà FINALISÉ ne doit plus jamais changer, même si
 * le modèle de l'entreprise est modifié après coup. Le texte rendu (`renderedText`) est donc figé une
 * fois pour toutes dans `lease_contracts.snapshot` au moment de la finalisation (voir
 * `finalizeContract`) et n'est plus jamais recalculé depuis le modèle courant. Les contrats finalisés
 * AVANT cette fonctionnalité (dont le `snapshot` ne contient pas encore `renderedText`) sont, à la
 * lecture, rendus avec `DEFAULT_CONTRACT_TEMPLATE` — jamais le modèle personnalisé courant de
 * l'entreprise, qui n'existait pas à l'époque — appliqué à leurs données figées : cela reproduit
 * fidèlement ce qui a été réellement signé, sans nécessiter de migration de données.
 */

const DEFAULT_CONTRACT_TEMPLATE = `## Les parties
Entre les soussignés : d'une part, {{nom_bailleur}}{{clause_adresse_bailleur}}, propriétaire du bien désigné à l'article 2, représenté aux fins des présentes par l'entreprise {{nom_entreprise}} (RCCM {{rccm_entreprise}}, IFU {{ifu_entreprise}}), ci-après dénommé « le Bailleur » ; et d'autre part, {{nom_locataire}}, joignable au {{telephone_locataire}}, ci-après dénommé « le Locataire ». Il a été convenu ce qui suit.

## Objet du contrat
Le Bailleur donne à bail au Locataire, qui accepte, le bien désigné « {{designation_logement}} » ({{code_logement}}) au sein de l'immeuble {{code_immeuble}} ({{type_immeuble}}){{clause_adresse_bien}}, livré {{meuble_ou_non}}{{clause_compteurs}}. Le Locataire déclare avoir visité les lieux et les accepter en l'état constaté par l'état des lieux d'entrée établi séparément.

## Durée et prise d'effet
Le présent bail prend effet le {{date_debut_bail}}, pour une durée indéterminée. Chaque partie peut y mettre fin dans les conditions prévues à l'article 8 ci-après.

## Loyer et modalités de paiement
Le loyer mensuel est fixé à {{loyer_mensuel}}, payable {{convention_paiement_loyer}}, {{clause_echeance_loyer}}{{clause_frais_agence}}

## Caution(s)
{{clause_cautions}}

## Obligations du Locataire
Le Locataire s'engage à : payer le loyer et les charges aux échéances convenues ; occuper les lieux personnellement et paisiblement, sans les sous-louer ni les céder sans l'accord écrit préalable du Bailleur ; entretenir le logement et le rendre, à son départ, dans l'état constaté à son entrée, sauf vétusté normale ; signaler sans délai toute dégradation ou panne constatée ; permettre l'accès au logement pour toute visite ou réparation justifiée, sur préavis raisonnable.

## Obligations du Bailleur
Le Bailleur s'engage à : délivrer un logement décent et en bon état d'usage ; assurer la jouissance paisible des lieux au Locataire ; prendre en charge les grosses réparations qui ne résultent pas d'un défaut d'entretien du Locataire ; restituer la ou les cautions dans les conditions de l'article 5.

## Résiliation
Chaque partie peut résilier le présent bail moyennant un préavis raisonnable notifié par écrit à l'autre partie. À la sortie du Locataire, un état des lieux contradictoire est établi ; le décompte de la ou des cautions en découle, selon les conditions de l'article 5.`;

/** Jetons disponibles dans le modèle, affichés en aide dans Paramètres. */
const CONTRACT_TEMPLATE_PLACEHOLDERS = [
  { token: 'nom_bailleur', description: 'Nom du propriétaire' },
  { token: 'clause_adresse_bailleur', description: "Adresse du propriétaire, déjà formulée (ou vide)" },
  { token: 'nom_entreprise', description: "Nom de l'entreprise de gestion" },
  { token: 'rccm_entreprise', description: "RCCM de l'entreprise" },
  { token: 'ifu_entreprise', description: "IFU de l'entreprise" },
  { token: 'nom_locataire', description: 'Nom complet du locataire' },
  { token: 'telephone_locataire', description: 'Téléphone du locataire' },
  { token: 'designation_logement', description: 'Désignation du logement (ex. Studio)' },
  { token: 'code_logement', description: 'Code du logement' },
  { token: 'code_immeuble', description: "Code de l'immeuble" },
  { token: 'type_immeuble', description: "Type de l'immeuble" },
  { token: 'clause_adresse_bien', description: 'Adresse du bien, déjà formulée (ou vide)' },
  { token: 'meuble_ou_non', description: '« meublé » ou « non meublé »' },
  { token: 'clause_compteurs', description: 'Numéros de compteurs SONEB/SBEE, déjà formulés (ou vide)' },
  { token: 'date_debut_bail', description: 'Date de prise d’effet du bail' },
  { token: 'loyer_mensuel', description: 'Montant du loyer mensuel (FCFA)' },
  { token: 'convention_paiement_loyer', description: 'Convention de paiement (avance/terme échu)' },
  { token: 'clause_echeance_loyer', description: "Phrase d'échéance de paiement, déjà formulée" },
  { token: 'clause_frais_agence', description: "Phrase des frais d'agence, déjà formulée (ou vide)" },
  { token: 'clause_cautions', description: 'Phrase des cautions, déjà formulée' },
];

/**
 * Construit les valeurs des balises à partir des données du bail (`buildContractData`) et des champs
 * d'identité de l'entreprise. Chaque valeur est déjà une phrase complète (ou vide) — jamais une donnée
 * brute nécessitant une condition côté modèle.
 */
function buildTemplatePlaceholders(data, tenantFields) {
  const { formatFcfa, formatDateFr, rentDueOffsetPhrase } = require('./pdf');

  const meterParts = [];
  if (data.unit.sonebMeterNumber) meterParts.push(`compteur SONEB n° ${data.unit.sonebMeterNumber}`);
  if (data.unit.sbeeMeterNumber) meterParts.push(`compteur SBEE n° ${data.unit.sbeeMeterNumber}`);

  const depositLines = [];
  if (data.lease.depositAmount > 0) depositLines.push(`une caution de loyer de ${formatFcfa(data.lease.depositAmount)}`);
  for (const d of data.additionalDeposits) depositLines.push(`une caution ${d.typeLabel} de ${formatFcfa(d.amount)}`);

  return {
    nom_bailleur: data.owner.name,
    clause_adresse_bailleur: data.owner.address ? `, domicilié à ${data.owner.address}` : '',
    nom_entreprise: tenantFields.company_name,
    rccm_entreprise: tenantFields.rccm,
    ifu_entreprise: tenantFields.ifu,
    nom_locataire: `${data.renter.firstName} ${data.renter.lastName}`,
    telephone_locataire: data.renter.phone,
    designation_logement: data.unit.designationLabel,
    code_logement: data.unit.code,
    code_immeuble: data.property.code,
    type_immeuble: data.property.typeLabel,
    clause_adresse_bien: data.property.address ? `, sis ${data.property.address}` : '',
    meuble_ou_non: data.unit.furnished ? 'meublé' : 'non meublé',
    clause_compteurs: meterParts.length > 0 ? `, équipé des compteurs suivants : ${meterParts.join(', ')}` : '',
    date_debut_bail: formatDateFr(data.lease.startDate),
    loyer_mensuel: formatFcfa(data.lease.monthlyRent),
    convention_paiement_loyer: data.lease.rentTimingLabel.toLowerCase(),
    clause_echeance_loyer:
      (data.lease.rentDueDay != null
        ? `au plus tard le ${data.lease.rentDueDay} de chaque mois concerné.`
        : `au plus tard ${rentDueOffsetPhrase(data.lease.rentDueOffsetDays)} chaque période concernée.`),
    clause_frais_agence:
      data.lease.entryFeeAmount > 0
        ? ` Des frais d'agence de ${formatFcfa(data.lease.entryFeeAmount)}, dus une seule fois à la signature, ` +
          `restent intégralement acquis à l'entreprise et ne sont pas restituables.`
        : '',
    clause_cautions:
      depositLines.length > 0
        ? `Le Locataire verse, à la signature, ${depositLines.join(', ')}. Chaque caution est intégralement restituable ` +
          `en fin de bail, déduction faite des dégradations et/ou impayés constatés à la sortie (état des lieux ` +
          `contradictoire), dans les conditions détaillées sur le décompte remis au Locataire à cette occasion.`
        : `Aucune caution n'est exigée à la signature du présent bail.`,
  };
}

/** Remplacement simple `{{jeton}}` → valeur. Un jeton inconnu (faute de frappe) est laissé tel quel, visible. */
function renderContractTemplate(template, placeholders) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(placeholders, key) ? String(placeholders[key] ?? '') : match,
  );
}

/**
 * Calcule le texte final des articles (hors « Conditions particulières », gérée séparément) : modèle
 * de l'entreprise si personnalisé, sinon `DEFAULT_CONTRACT_TEMPLATE`.
 */
function renderContractText(tenantFields, data) {
  const template = tenantFields?.lease_contract_template || DEFAULT_CONTRACT_TEMPLATE;
  return renderContractTemplate(template, buildTemplatePlaceholders(data, tenantFields));
}

/**
 * Découpe un texte rendu en articles `{ title, body }`, selon la convention `## Titre`. Partagé par le
 * rendu PDF (`pdf.js`) et l'affichage web (même règle des deux côtés).
 */
function parseContractBlocks(renderedText) {
  const lines = String(renderedText || '').replace(/\r\n/g, '\n').split('\n');
  const articles = [];
  let current = null;
  for (const line of lines) {
    const headingMatch = /^##\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      current = { title: headingMatch[1].trim(), bodyLines: [] };
      articles.push(current);
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  return articles
    .map((a) => ({ title: a.title, body: a.bodyLines.join('\n').trim().replace(/\n{3,}/g, '\n\n') }))
    .filter((a) => a.title && a.body);
}

module.exports = {
  DEFAULT_CONTRACT_TEMPLATE,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  buildTemplatePlaceholders,
  renderContractTemplate,
  renderContractText,
  parseContractBlocks,
};
