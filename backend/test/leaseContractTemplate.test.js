'use strict';

/**
 * Modèle personnalisable du contrat de bail (demande utilisateur, 2026-11-05) — voir
 * `services/leaseContractTemplate.js`. Tests purs (aucune base requise) : substitution des balises,
 * jeton inconnu laissé visible, découpage en articles, modèle par défaut cohérent.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONTRACT_TEMPLATE,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  renderContractTemplate,
  parseContractBlocks,
  buildTemplatePlaceholders,
  renderContractText,
} = require('../src/services/leaseContractTemplate');

test('renderContractTemplate — remplace les balises connues, laisse une balise inconnue visible (faute de frappe)', () => {
  const out = renderContractTemplate('Bonjour {{nom}}, votre loyer est {{loyer}} — {{inconnu}}.', {
    nom: 'Jean',
    loyer: '50 000 FCFA',
  });
  assert.equal(out, 'Bonjour Jean, votre loyer est 50 000 FCFA — {{inconnu}}.');
});

test('renderContractTemplate — une valeur vide remplace bien la balise par du vide, pas par le littéral', () => {
  const out = renderContractTemplate('Caution{{clause}}.', { clause: '' });
  assert.equal(out, 'Caution.');
});

test('parseContractBlocks — découpe en articles selon la convention "## Titre"', () => {
  const text = `## Premier\nCorps du premier article.\n\n## Deuxième\nLigne 1.\nLigne 2.`;
  const articles = parseContractBlocks(text);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, 'Premier');
  assert.equal(articles[0].body, 'Corps du premier article.');
  assert.equal(articles[1].title, 'Deuxième');
  assert.equal(articles[1].body, 'Ligne 1.\nLigne 2.');
});

test('parseContractBlocks — ignore un article sans titre ou sans corps', () => {
  assert.deepEqual(parseContractBlocks(''), []);
  assert.deepEqual(parseContractBlocks('## Titre seul, sans corps\n'), []);
});

test('DEFAULT_CONTRACT_TEMPLATE — reproduit les 8 articles historiques (hors Conditions particulières, gérée séparément)', () => {
  const placeholders = buildTemplatePlaceholders(
    {
      owner: { name: 'Propriétaire Test', address: null },
      renter: { firstName: 'Jean', lastName: 'Dupont', phone: '0100000000' },
      property: { code: 'IMM-01', address: null, typeLabel: 'Immeuble' },
      unit: { code: 'U1', designationLabel: 'Studio', furnished: false, sonebMeterNumber: null, sbeeMeterNumber: null },
      lease: {
        startDate: '2026-01-01',
        monthlyRent: 50000,
        rentDueDay: 5,
        rentDueOffsetDays: null,
        rentTiming: 'avance',
        rentTimingLabel: "Payé d'avance",
        depositAmount: 50000,
        entryFeeAmount: 0,
      },
      additionalDeposits: [],
      particularConditions: null,
    },
    { company_name: 'ACME SARL', rccm: 'RCCM-X', ifu: 'IFU-X' },
  );
  const rendered = renderContractTemplate(DEFAULT_CONTRACT_TEMPLATE, placeholders);
  const articles = parseContractBlocks(rendered);
  assert.equal(articles.length, 8);
  assert.equal(articles[0].title, 'Les parties');
  assert.match(articles[0].body, /Propriétaire Test/);
  assert.match(articles[0].body, /ACME SARL/);
  assert.doesNotMatch(rendered, /\{\{/, 'aucune balise ne doit rester non résolue avec des données complètes');
});

test('renderContractText — retombe sur le modèle par défaut quand aucun modèle personnalisé n\'est enregistré', () => {
  const data = {
    owner: { name: 'P', address: null },
    renter: { firstName: 'J', lastName: 'D', phone: '0100000000' },
    property: { code: 'IMM-01', address: null, typeLabel: 'Immeuble' },
    unit: { code: 'U1', designationLabel: 'Studio', furnished: false, sonebMeterNumber: null, sbeeMeterNumber: null },
    lease: {
      startDate: '2026-01-01',
      monthlyRent: 50000,
      rentDueDay: 5,
      rentDueOffsetDays: null,
      rentTiming: 'avance',
      rentTimingLabel: "Payé d'avance",
      depositAmount: 50000,
      entryFeeAmount: 0,
    },
    additionalDeposits: [],
    particularConditions: null,
  };
  const withoutCustom = renderContractText({ company_name: 'ACME', rccm: 'R', ifu: 'I', lease_contract_template: null }, data);
  const withCustom = renderContractText(
    { company_name: 'ACME', rccm: 'R', ifu: 'I', lease_contract_template: '## Seul article\nTexte personnalisé {{nom_locataire}}.' },
    data,
  );
  assert.equal(parseContractBlocks(withoutCustom).length, 8);
  assert.equal(parseContractBlocks(withCustom).length, 1);
  assert.match(withCustom, /Texte personnalisé J D\./);
});

test('CONTRACT_TEMPLATE_PLACEHOLDERS — chaque jeton documenté apparaît bien dans le modèle par défaut', () => {
  for (const { token } of CONTRACT_TEMPLATE_PLACEHOLDERS) {
    assert.match(DEFAULT_CONTRACT_TEMPLATE, new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`), `jeton {{${token}}} absent du modèle par défaut`);
  }
});
