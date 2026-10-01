'use strict';

/**
 * `computeArrears` — le calcul de retard ne doit jamais remonter avant que
 * Lyko System ne suive réellement le bail (demande directe de l'utilisateur :
 * un locataire entré dans les lieux en 2025 mais enregistré aujourd'hui, à
 * jour, ne doit rien). Fonctions pures, aucune base requise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeArrears,
  allocateRentPayment,
  isPaymentLate,
  recentMonthlyLateCount,
  buildRentStrip,
  summarizeRentMonth,
  firstRegularDueDate,
  computeEntryProrata,
} = require('../src/services/rentTracking');

const TODAY = new Date('2026-09-22T00:00:00Z');

test('computeArrears — sans createdAt (compatibilité) : comportement historique inchangé', () => {
  // Bail entré en 2025, aucun paiement enregistré, pas de createdAt fourni
  // : doit tout devoir depuis 2025 (comportement d'avant ce correctif).
  const arrears = computeArrears(
    { startDate: '2025-01-01', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2025-01');
  assert.equal(arrears.status, 'late');
});

test("computeArrears — createdAt postérieur à startDate : plafonne au mois d'enregistrement (le vrai bug corrigé)", () => {
  // Même bail (entré en 2025), mais enregistré sur la plateforme le
  // 2026-09-10 : ne doit RIEN pour les 20 mois passés, seulement à partir
  // du mois d'enregistrement.
  const arrears = computeArrears(
    { startDate: '2025-01-01', createdAt: '2026-09-10', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-09');
  // Échéance du 5 septembre déjà passée (aujourd'hui le 22) : en retard de
  // CE seul mois, jamais des 20 précédents.
  assert.equal(arrears.status, 'late');
  assert.equal(arrears.monthsLate, 0);
  assert.ok(arrears.daysLate > 0 && arrears.daysLate < 31);
});

test("computeArrears — upToDateAtOnboarding : couvre aussi le mois d'enregistrement lui-même", () => {
  const arrears = computeArrears(
    { startDate: '2025-01-01', createdAt: '2026-09-10', upToDateAtOnboarding: true, rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10', "le mois d'enregistrement (septembre) est aussi couvert");
  assert.equal(arrears.status, 'current');
});

test('computeArrears — createdAt antérieur à startDate (bail signé en avance) : startDate reste le plafond', () => {
  // Bail signé aujourd'hui pour une entrée le mois prochain : le loyer
  // n'est dû qu'à partir de l'entrée réelle, jamais avant.
  const arrears = computeArrears(
    { startDate: '2026-10-01', createdAt: '2026-09-22', rentDueDay: 5, payments: [] },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.status, 'current');
});

test('computeArrears — un vrai paiement après la date de plafond avance nextDueMonth normalement', () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      payments: [{ coversMonth: '2026-09' }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.status, 'current');
});

// Audit comptable du 23/09/2026, anomalie A1 : un paiement PARTIEL ne doit
// JAMAIS faire avancer nextDueMonth comme un paiement complet — sans
// `monthlyRent`, c'était pourtant exactement ce qui se produisait (voir les
// tests "compatibilité" ci-dessus, qui reproduisent volontairement l'ancien
// comportement en omettant `monthlyRent`).

test("computeArrears — AVEC monthlyRent : un paiement partiel (40000/100000) ne libère PAS le mois", () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [{ coversMonth: '2026-09', amount: 40000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-09', 'le mois partiellement payé reste dû, pas le mois suivant');
  assert.equal(arrears.paidForNextDueMonth, 40000);
  assert.equal(arrears.status, 'late');
});

test('computeArrears — AVEC monthlyRent : plusieurs paiements partiels du MÊME mois se cumulent avant de libérer le mois suivant', () => {
  const arrearsPartiel = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [
        { coversMonth: '2026-09', amount: 40000 },
        { coversMonth: '2026-09', amount: 59999 },
      ],
    },
    TODAY,
  );
  assert.equal(arrearsPartiel.nextDueMonth, '2026-09', "99999 < 100000 : encore dû d'1 FCFA");

  const arrearsComplet = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [
        { coversMonth: '2026-09', amount: 40000 },
        { coversMonth: '2026-09', amount: 60000 },
      ],
    },
    TODAY,
  );
  assert.equal(arrearsComplet.nextDueMonth, '2026-10', 'cumul exact du loyer : le mois est enfin libéré');
  assert.equal(arrearsComplet.status, 'current');
});

test('computeArrears — AVEC monthlyRent : un paiement PLEIN se comporte exactement comme avant', () => {
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      monthlyRent: 100000,
      payments: [{ coversMonth: '2026-09', amount: 100000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10');
  assert.equal(arrears.paidForNextDueMonth, 0);
  assert.equal(arrears.status, 'current');
});

test("computeArrears — `monthlyRent` omis (compatibilité) : ancien comportement buggé volontairement conservé", () => {
  // Un appelant pas encore mis à jour ne doit jamais planter — juste
  // retomber sur l'ancien calcul (déjà couvert par le test ci-dessus qui
  // omet monthlyRent), documenté ici explicitement pour le cas partiel.
  const arrears = computeArrears(
    {
      startDate: '2025-01-01',
      createdAt: '2026-09-10',
      rentDueDay: 5,
      payments: [{ coversMonth: '2026-09', amount: 40000 }],
    },
    TODAY,
  );
  assert.equal(arrears.nextDueMonth, '2026-10', 'sans monthlyRent, une ligne partielle libère quand même le mois (ancien comportement)');
});

test("allocateRentPayment — complète d'abord le reliquat d'un mois déjà partiel avant d'attaquer le mois suivant", () => {
  // Mois de septembre déjà réglé à 40000/100000 ; un nouveau paiement de
  // 60000 doit compléter EXACTEMENT septembre, sans créer octobre.
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 60000,
  });
  assert.deepEqual(result.allocations, [{ coversMonth: '2026-09', amount: 60000, isPartial: false }]);
});

test('allocateRentPayment — complète le reliquat ET couvre un mois plein supplémentaire', () => {
  // 40000 déjà réglés en septembre ; le locataire paie 160000 : 60000
  // complètent septembre, 100000 couvrent octobre intégralement.
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 160000,
  });
  assert.deepEqual(result.allocations, [
    { coversMonth: '2026-09', amount: 60000, isPartial: false },
    { coversMonth: '2026-10', amount: 100000, isPartial: false },
  ]);
});

test("allocateRentPayment — un nouveau paiement encore insuffisant pour le reliquat reste sur le même mois", () => {
  const result = allocateRentPayment({
    nextDueMonth: '2026-09',
    monthlyRent: 100000,
    alreadyPaidForNextDueMonth: 40000,
    amount: 30000,
  });
  assert.deepEqual(result.allocations, [{ coversMonth: '2026-09', amount: 30000, isPartial: true }]);
});

// Convention de paiement du loyer (demande directe de l'utilisateur,
// 2026-09-24) : 'terme_echu' repousse l'échéance au mois SUIVANT celui
// facturé (le loyer de septembre ne se paie qu'en octobre), au lieu du mois
// facturé lui-même ('avance', défaut, comportement historique).

test("computeArrears — 'terme_echu' repousse l'échéance au mois suivant (peut inverser le statut)", () => {
  // Loyer de septembre : sans paiement, le 22 septembre.
  const base = { startDate: '2026-09-01', rentDueDay: 5, monthlyRent: 100000, payments: [] };

  const avance = computeArrears({ ...base, rentTiming: 'avance' }, TODAY);
  assert.equal(avance.dueDate, '2026-09-05');
  assert.equal(avance.status, 'late', "avance : échéance le 5 septembre, déjà dépassée le 22");

  const termeEchu = computeArrears({ ...base, rentTiming: 'terme_echu' }, TODAY);
  assert.equal(termeEchu.dueDate, '2026-10-05');
  assert.equal(termeEchu.status, 'current', "terme échu : le loyer de septembre n'est dû que le 5 octobre");

  const omis = computeArrears(base, TODAY);
  assert.equal(omis.dueDate, avance.dueDate, "rentTiming omis (compatibilité) : identique à 'avance'");
});

test("isPaymentLate — même bascule que computeArrears selon la convention", () => {
  // Loyer d'août, réglé le 3 septembre.
  assert.equal(isPaymentLate('2026-08', 5, '2026-09-03', 'avance'), true, "avance : échéance le 5 août, réglé après");
  assert.equal(isPaymentLate('2026-08', 5, '2026-09-03', 'terme_echu'), false, "terme échu : échéance le 5 septembre, réglé avant");
  assert.equal(isPaymentLate('2026-08', 5, '2026-09-03'), true, "rentTiming omis (compatibilité) : identique à 'avance'");
});

test('allocateRentPayment — sans reliquat (mois neuf), comportement identique à avant ce correctif', () => {
  const result = allocateRentPayment({ nextDueMonth: '2026-09', monthlyRent: 100000, amount: 250000 });
  assert.deepEqual(result.allocations, [
    { coversMonth: '2026-09', amount: 100000, isPartial: false },
    { coversMonth: '2026-10', amount: 100000, isPartial: false },
    { coversMonth: '2026-11', amount: 50000, isPartial: true },
  ]);
});

test("computeArrears — « payé jusqu'à » = dernier mois SOLDÉ consécutif (jamais un mois partiel ni un mois payé après un trou)", () => {
  const pay = (coversMonth, amount) => ({ coversMonth, amount });
  const base = { startDate: '2026-08-01', createdAt: '2026-08-01', rentDueDay: 5, monthlyRent: 75000 };

  // Août à novembre soldés, décembre seulement entamé (50 000 / 75 000) : payé jusqu'à NOVEMBRE.
  let a = computeArrears(
    { ...base, payments: [pay('2026-08', 75000), pay('2026-09', 75000), pay('2026-10', 75000), pay('2026-11', 75000), pay('2026-12', 30000), pay('2026-12', 20000)] },
    TODAY,
  );
  assert.equal(a.paidThroughMonth, '2026-11');
  assert.equal(a.nextDueMonth, '2026-12');
  assert.equal(a.paidForNextDueMonth, 50000);

  // Trou : août soldé, septembre impayé, octobre soldé → payé jusqu'à AOÛT seulement.
  a = computeArrears({ ...base, payments: [pay('2026-08', 75000), pay('2026-10', 75000)] }, TODAY);
  assert.equal(a.paidThroughMonth, '2026-08');
  assert.equal(a.nextDueMonth, '2026-09');

  // Aucun paiement : aucun mois.
  assert.equal(computeArrears({ ...base, payments: [] }, TODAY).paidThroughMonth, null);

  // Premier mois seulement entamé : aucun mois soldé.
  assert.equal(computeArrears({ ...base, payments: [pay('2026-08', 20000)] }, TODAY).paidThroughMonth, null);

  // Tout soldé jusqu'à octobre : inchangé par rapport à avant.
  a = computeArrears({ ...base, payments: [pay('2026-08', 75000), pay('2026-09', 75000), pay('2026-10', 75000)] }, TODAY);
  assert.equal(a.paidThroughMonth, '2026-10');
  assert.equal(a.nextDueMonth, '2026-11');

  // Locataire déjà en place, enregistré en septembre, loyers antérieurs payés avant le suivi :
  // le dernier mois payé AVANT le début du suivi reste affiché.
  a = computeArrears(
    { startDate: '2026-01-01', createdAt: '2026-09-10', rentDueDay: 5, monthlyRent: 75000, payments: [pay('2026-07', 75000), pay('2026-08', 75000)] },
    TODAY,
  );
  assert.equal(a.paidThroughMonth, '2026-08');
  assert.equal(a.nextDueMonth, '2026-09');

  // Sans monthlyRent (compatibilité) : dernier mois ayant reçu un paiement, comme avant.
  a = computeArrears({ startDate: '2026-08-01', createdAt: '2026-08-01', rentDueDay: 5, payments: [pay('2026-08', 100), pay('2026-10', 100)] }, TODAY);
  assert.equal(a.paidThroughMonth, '2026-10');
});


// ── Frise des 12 mois (buildRentStrip) ─────────────────────────────────────

const statusOf = (strip) => Object.fromEntries(strip.map((m) => [m.month, m.status]));
const pay = (coversMonth, amount) => ({ coversMonth, amount });

test('buildRentStrip — 12 mois consécutifs : 8 passés, le mois en cours, 3 à venir', () => {
  const strip = buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 75000, payments: [] }, TODAY);
  assert.equal(strip.length, 12);
  assert.deepEqual(strip.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.deepEqual(strip.filter((m) => m.isCurrent).map((m) => m.month), ['2026-09']);
  // La fenêtre traverse bien un changement d'année.
  const across = buildRentStrip({ startDate: '2025-01-01', rentDueDay: 5, monthlyRent: 1, payments: [] }, new Date('2027-02-10T00:00:00Z'));
  assert.equal(across[0].month, '2026-06');
  assert.equal(across[11].month, '2027-05');
});

test("buildRentStrip — convention d'avance : payé / partiel en retard / en retard / à venir", () => {
  const payments = ['01', '02', '03', '04', '05', '06'].map((m) => pay(`2026-${m}`, 75000)).concat([pay('2026-07', 30000)]);
  const strip = buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 75000, payments }, TODAY);
  const st = statusOf(strip);
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) assert.equal(st[m], 'paye', m);
  assert.equal(st['2026-07'], 'partiel');
  const july = strip.find((m) => m.month === '2026-07');
  assert.equal(july.paid, 30000);
  assert.equal(july.remaining, 45000);
  assert.equal(july.late, true, 'juillet est partiel ET son échéance (5 juillet) est passée');
  assert.equal(st['2026-08'], 'en_retard');
  assert.equal(st['2026-09'], 'en_retard', 'échéance du 5 septembre passée (aujourd\'hui le 22)');
  assert.equal(st['2026-10'], 'a_venir');
  assert.equal(st['2026-12'], 'a_venir');
  assert.equal(strip.find((m) => m.month === '2026-08').dueDate, '2026-08-05');
});

test("buildRentStrip — à terme échu : le loyer d'un mois n'est dû que le mois suivant", () => {
  const strip = buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, rentTiming: 'terme_echu', monthlyRent: 75000, payments: [] }, TODAY);
  const st = statusOf(strip);
  assert.equal(st['2026-08'], 'en_retard', 'août est dû le 5 septembre : passé');
  assert.equal(st['2026-09'], 'a_payer', 'septembre est dû le 5 octobre : pas encore en retard');
  assert.equal(st['2026-10'], 'a_venir');
  assert.equal(strip.find((m) => m.month === '2026-09').dueDate, '2026-10-05');
});

test('buildRentStrip — suivi démarré tard : les mois d\'avant ne sont ni en retard ni « à jour »', () => {
  // Entré en janvier, mais enregistré sur la plateforme le 10 juin.
  const st = statusOf(buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-06-10', rentDueDay: 5, monthlyRent: 75000, payments: [] }, TODAY));
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) assert.equal(st[m], 'avant_suivi', m);
  assert.equal(st['2026-06'], 'en_retard');
  // Un mois d'avant le suivi réellement payé s'affiche payé.
  const paid = statusOf(buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-06-10', rentDueDay: 5, monthlyRent: 75000, payments: [pay('2026-05', 75000)] }, TODAY));
  assert.equal(paid['2026-05'], 'paye');
  // Entré « à jour » : le mois de l'enregistrement n'est pas réclamé non plus.
  const upToDate = statusOf(buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-09-10', upToDateAtOnboarding: true, rentDueDay: 5, monthlyRent: 75000, payments: [] }, TODAY));
  assert.equal(upToDate['2026-09'], 'avant_suivi');
  assert.equal(upToDate['2026-10'], 'a_venir');
});

test('buildRentStrip — bail commencé en cours de fenêtre ou terminé : hors_bail', () => {
  const started = statusOf(buildRentStrip({ startDate: '2026-04-15', createdAt: '2026-04-15', rentDueDay: 5, monthlyRent: 75000, payments: [] }, TODAY));
  for (const m of ['2026-01', '2026-02', '2026-03']) assert.equal(started[m], 'hors_bail', m);
  assert.equal(started['2026-04'], 'en_retard');

  const ended = statusOf(buildRentStrip({ startDate: '2026-01-01', endDate: '2026-07-31', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 75000, payments: [pay('2026-01', 75000)] }, TODAY));
  assert.equal(ended['2026-01'], 'paye');
  assert.equal(ended['2026-07'], 'en_retard');
  for (const m of ['2026-08', '2026-09', '2026-12']) assert.equal(ended[m], 'hors_bail', m);
});

test("buildRentStrip — paiements d'avance : un mois futur entamé est partiel sans être en retard ; un mois futur soldé est payé", () => {
  const strip = buildRentStrip(
    { startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 75000, payments: [pay('2026-11', 20000), pay('2026-12', 75000)] },
    TODAY,
  );
  const nov = strip.find((m) => m.month === '2026-11');
  assert.equal(nov.status, 'partiel');
  assert.equal(nov.late, false);
  assert.equal(strip.find((m) => m.month === '2026-12').status, 'paye');
  // Plusieurs paiements du même mois se cumulent.
  const cumul = buildRentStrip({ startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 75000, payments: [pay('2026-08', 30000), pay('2026-08', 45000)] }, TODAY);
  assert.equal(cumul.find((m) => m.month === '2026-08').status, 'paye');
});

test('buildRentStrip — cohérent avec computeArrears : le premier mois non soldé est nextDueMonth, et « en retard » ⇔ status late', () => {
  const lease = {
    startDate: '2026-01-01',
    createdAt: '2026-01-01',
    rentDueDay: 5,
    monthlyRent: 75000,
    payments: ['01', '02', '03', '04', '05'].map((m) => pay(`2026-${m}`, 75000)).concat([pay('2026-06', 40000)]),
  };
  const arrears = computeArrears(lease, TODAY);
  const strip = buildRentStrip(lease, TODAY);
  const firstUnsettled = strip.find((m) => m.status !== 'paye');
  assert.equal(firstUnsettled.month, arrears.nextDueMonth);
  assert.equal(firstUnsettled.status, 'partiel');
  assert.equal(firstUnsettled.paid, arrears.paidForNextDueMonth);
  assert.equal(arrears.status, 'late');
  assert.equal(firstUnsettled.late, true);
  // Terme échu : même cohérence sur le statut de retard.
  for (const rentTiming of ['avance', 'terme_echu']) {
    const l = { ...lease, rentTiming, payments: lease.payments.slice(0, 5).concat([pay('2026-06', 75000), pay('2026-07', 75000), pay('2026-08', 75000)]) };
    const a = computeArrears(l, TODAY);
    const s = buildRentStrip(l, TODAY);
    const next = s.find((m) => m.month === a.nextDueMonth);
    assert.equal(next.dueDate, a.dueDate, `${rentTiming} : même date d'échéance`);
    assert.equal(next.late, a.status === 'late', `${rentTiming} : même verdict de retard`);
  }
});


// ── Encadré « Ce mois-ci » (summarizeRentMonth) ────────────────────────────

const lease = (o) => ({ startDate: '2026-01-01', createdAt: '2026-01-01', rentDueDay: 5, monthlyRent: 50000, paid: 0, ...o });

test('summarizeRentMonth — attendu, encaissé, reste ; retard vs pas encore dû ; baux hors sujet ignorés', () => {
  const leases = [
    lease({ monthlyRent: 75000, paid: 75000 }), // A : payé
    lease({ monthlyRent: 100000, paid: 40000 }), // B : partiel, échéance (5) passée → en retard
    lease({ monthlyRent: 60000, rentDueDay: 28 }), // C : rien, échéance le 28 → à payer
    lease({ monthlyRent: 50000 }), // D : rien, échéance passée → en retard
    lease({ monthlyRent: 80000, rentTiming: 'terme_echu' }), // H : dû le 5 octobre → à payer
    lease({ monthlyRent: 999999, endDate: '2026-08-31' }), // E : bail terminé fin août → ignoré
    lease({ monthlyRent: 999999, startDate: '2026-10-01', createdAt: '2026-10-01' }), // F : commence en octobre → ignoré
    lease({ monthlyRent: 999999, createdAt: '2026-09-10', upToDateAtOnboarding: true }), // G : entré « à jour » en septembre → ignoré
  ];
  const r = summarizeRentMonth(leases, '2026-09', TODAY);
  assert.equal(r.counts.leases, 5);
  assert.deepEqual({ paye: r.counts.paye, partiel: r.counts.partiel, en_retard: r.counts.en_retard, a_payer: r.counts.a_payer, a_venir: r.counts.a_venir, late: r.counts.late },
    { paye: 1, partiel: 1, en_retard: 1, a_payer: 2, a_venir: 0, late: 2 });
  assert.equal(r.expected, 75000 + 100000 + 60000 + 50000 + 80000);
  assert.equal(r.collected, 75000 + 40000);
  assert.equal(r.remaining, 60000 + 60000 + 50000 + 80000);
  assert.equal(r.lateRemaining, 60000 + 50000, 'B (reste 60 000) et D (50 000) sont en retard');
  assert.equal(r.upcomingRemaining, 60000 + 80000, 'C et H ne sont pas encore dus');
  assert.equal(r.expected, r.collected + r.remaining, 'invariant : attendu = encaissé + reste');
  assert.equal(r.lateRemaining + r.upcomingRemaining, r.remaining);
});

test('summarizeRentMonth — mois futur : rien n\'est en retard ; aucun bail : zéros ; surpaiement plafonné', () => {
  const future = summarizeRentMonth([lease({ monthlyRent: 75000 }), lease({ monthlyRent: 50000, paid: 20000 })], '2026-12', TODAY);
  assert.equal(future.counts.a_venir, 1);
  assert.equal(future.counts.partiel, 1);
  assert.equal(future.counts.late, 0);
  assert.equal(future.lateRemaining, 0);
  assert.equal(future.remaining, 75000 + 30000);

  const none = summarizeRentMonth([], '2026-09', TODAY);
  assert.equal(none.expected + none.collected + none.remaining, 0);
  assert.equal(none.counts.leases, 0);

  // Un cumul supérieur au loyer (anormal) ne fait jamais dépasser l'attendu.
  const over = summarizeRentMonth([lease({ monthlyRent: 50000, paid: 80000 })], '2026-09', TODAY);
  assert.equal(over.collected, 50000);
  assert.equal(over.remaining, 0);
  assert.equal(over.expected, over.collected + over.remaining);
});

test('summarizeRentMonth — cohérent avec la frise : même état de chaque bail pour le mois', () => {
  const cases = [
    lease({ monthlyRent: 75000, paid: 75000 }),
    lease({ monthlyRent: 100000, paid: 40000 }),
    lease({ monthlyRent: 60000, rentDueDay: 28 }),
    lease({ monthlyRent: 50000 }),
    lease({ monthlyRent: 80000, rentTiming: 'terme_echu' }),
  ];
  for (const l of cases) {
    const strip = buildRentStrip({ ...l, payments: l.paid ? [{ coversMonth: '2026-09', amount: l.paid }] : [] }, TODAY);
    const septembre = strip.find((m) => m.month === '2026-09');
    const one = summarizeRentMonth([l], '2026-09', TODAY);
    assert.equal(one.counts[septembre.status], 1, `statut ${septembre.status}`);
    assert.equal(one.counts.late, septembre.late ? 1 : 0);
    assert.equal(one.remaining, septembre.remaining);
  }
});

// ───────────────────────────── prorata d'entrée (étape 42) ─────────────────────────────

test("firstRegularDueDate : le jour d'échéance du mois d'entrée si pas encore passé, sinon celui du mois suivant", () => {
  assert.equal(firstRegularDueDate('2026-09-02', 5), '2026-09-05', "entrée avant l'échéance du mois : reste dans le mois");
  assert.equal(firstRegularDueDate('2026-09-05', 5), '2026-09-05', "entrée LE jour d'échéance : ce jour même (0 jour de prorata)");
  assert.equal(firstRegularDueDate('2026-09-25', 5), '2026-10-05', "entrée après l'échéance du mois : mois suivant");
  assert.equal(firstRegularDueDate('2026-01-31', 28), '2026-02-28', 'traverse une fin de mois plus courte sans erreur');
  assert.equal(firstRegularDueDate('2026-12-25', 5), '2027-01-05', "traverse le changement d'année");
});

test("computeEntryProrata : jours + montant (loyer × jours ÷ 30, diviseur forfaitaire), jamais les jours réels du mois", () => {
  // Entrée le 25 septembre, échéance le 5 → 10 jours (26..30 sept + 1..5 oct — le 5 est le début du cycle normal).
  const a = computeEntryProrata({ startDate: '2026-09-25', monthlyRent: 60000, rentDueDay: 5 });
  assert.deepEqual(a, { days: 10, amount: 20000, dueDate: '2026-10-05' }); // 60000 * 10 / 30 = 20000
});

test('computeEntryProrata : entrée le jour même de l’échéance → aucun prorata (0 jour, 0 FCFA)', () => {
  const r = computeEntryProrata({ startDate: '2026-09-05', monthlyRent: 60000, rentDueDay: 5 });
  assert.deepEqual(r, { days: 0, amount: 0, dueDate: '2026-09-05' });
});

test('computeEntryProrata : le diviseur est FORFAITAIRE (30), pas le nombre réel de jours du mois', () => {
  // Entrée le 1er février (mois de 28 jours en 2026, non bissextile), échéance le 28 → 27 jours de prorata,
  // mais on divise quand même par 30 (jamais par 28).
  const r = computeEntryProrata({ startDate: '2026-02-01', monthlyRent: 30000, rentDueDay: 28 });
  assert.equal(r.days, 27);
  assert.equal(r.amount, Math.round((30000 * 27) / 30));
  assert.equal(r.amount, 27000);
});

test('computeEntryProrata : montant arrondi au franc le plus proche', () => {
  const r = computeEntryProrata({ startDate: '2026-09-28', monthlyRent: 50000, rentDueDay: 5 });
  // 2026-09-28 -> 2026-10-05 = 7 jours ; 50000 * 7 / 30 = 11666.66… -> 11667.
  assert.equal(r.days, 7);
  assert.equal(r.amount, 11667);
});

test('computeEntryProrata : loyer nul ou absent → prorata nul, jamais une erreur', () => {
  assert.deepEqual(computeEntryProrata({ startDate: '2026-09-25', monthlyRent: 0, rentDueDay: 5 }), { days: 10, amount: 0, dueDate: '2026-10-05' });
});

// ───────────── bug corrigé (audit comptable du 30/09/2026) : prorata d'entrée × computeArrears ─────────────

test('computeArrears — AVEC entryProration=prorata : jamais « en retard » sur le mois déjà couvert par le prorata', () => {
  // Reproduction exacte du bug trouvé par l'audit : bail signé le 2026-09-25 (rentDueDay=5, donc
  // premier cycle normal le 2026-10-05), aucun paiement de loyer encore (le prorata est réglé à part,
  // jamais via rent_payments). Le 2026-09-30 (5 jours après la signature), le locataire ne doit RIEN
  // encore au titre du cycle mensuel classique — la première échéance normale n'est que le 2026-10-05.
  const today = new Date('2026-09-30T00:00:00Z');
  const arrears = computeArrears(
    {
      startDate: '2026-09-25',
      createdAt: '2026-09-25',
      rentDueDay: 5,
      rentTiming: 'avance',
      monthlyRent: 60000,
      entryProration: 'prorata',
      payments: [],
    },
    today,
  );
  assert.equal(arrears.nextDueMonth, '2026-10', 'le cycle normal démarre au mois de la première échéance normale, pas au mois de signature');
  assert.equal(arrears.dueDate, '2026-10-05');
  assert.equal(arrears.status, 'current', "jamais 'late' le jour de l'emménagement sur un mois déjà couvert par le prorata");
  assert.equal(arrears.daysLate, -5);
});

test('computeArrears — SANS entryProration (ou "aucun") : comportement inchangé, toujours suivi depuis startDate', () => {
  // Même bail, mais sans prorata (ou entryProration omis) : le cycle normal part bien de startDate —
  // celui-ci doit donc apparaître en retard, comme avant ce correctif (non-régression).
  const today = new Date('2026-09-30T00:00:00Z');
  const arrearsOmitted = computeArrears(
    { startDate: '2026-09-25', createdAt: '2026-09-25', rentDueDay: 5, rentTiming: 'avance', monthlyRent: 60000, payments: [] },
    today,
  );
  const arrearsAucun = computeArrears(
    {
      startDate: '2026-09-25',
      createdAt: '2026-09-25',
      rentDueDay: 5,
      rentTiming: 'avance',
      monthlyRent: 60000,
      entryProration: 'aucun',
      payments: [],
    },
    today,
  );
  for (const arrears of [arrearsOmitted, arrearsAucun]) {
    assert.equal(arrears.nextDueMonth, '2026-09');
    assert.equal(arrears.status, 'late');
    assert.equal(arrears.daysLate, 25);
  }
});

test('buildRentStrip — AVEC entryProration=prorata : le mois de signature ne ressort jamais en_retard', () => {
  const today = new Date('2026-09-30T00:00:00Z');
  const strip = buildRentStrip(
    {
      startDate: '2026-09-25',
      createdAt: '2026-09-25',
      rentDueDay: 5,
      rentTiming: 'avance',
      monthlyRent: 60000,
      entryProration: 'prorata',
      payments: [],
    },
    today,
  );
  const september = strip.find((m) => m.month === '2026-09');
  assert.notEqual(september.status, 'en_retard', 'septembre est couvert par le prorata, jamais un mois en retard');
});

// ───── bug corrigé (étape 51bis, Moyenne #8) : alerte prédictive confondant versements partiels et mois distincts ─────

test("recentMonthlyLateCount — un SEUL mois réglé en 2 versements (partiel + complément en retard) compte pour 1 retard, jamais 2", () => {
  // Échéance le 5. Juillet : 2 versements pour le MÊME mois (30000 le 3, dans les temps ; 70000 le 10,
  // en retard — le mois n'est soldé/jugé qu'à la date du DERNIER versement). Juin et août : un seul
  // versement chacun, tous deux à temps.
  const { recentMonths, lateCount } = recentMonthlyLateCount(
    [
      { coversMonth: '2026-06', paidAt: '2026-06-04' },
      { coversMonth: '2026-07', paidAt: '2026-07-03' },
      { coversMonth: '2026-07', paidAt: '2026-07-10' },
      { coversMonth: '2026-08', paidAt: '2026-08-05' },
    ],
    5,
    'avance',
  );
  assert.equal(recentMonths.length, 3, '3 MOIS distincts, jamais 4 versements bruts');
  assert.equal(lateCount, 1, 'juillet compte pour UN SEUL retard (date du dernier versement), jamais deux');
});

test('recentMonthlyLateCount — 2 mois distincts réellement en retard déclenchent bien 2, comportement normal inchangé', () => {
  const { recentMonths, lateCount } = recentMonthlyLateCount(
    [
      { coversMonth: '2026-06', paidAt: '2026-06-10' },
      { coversMonth: '2026-07', paidAt: '2026-07-08' },
      { coversMonth: '2026-08', paidAt: '2026-08-04' },
    ],
    5,
    'avance',
  );
  assert.equal(recentMonths.length, 3);
  assert.equal(lateCount, 2, 'juin ET juillet sont réellement deux mois distincts en retard');
});

test("recentMonthlyLateCount — ne retient que les 3 MOIS les plus récents, jamais plus même avec davantage de versements", () => {
  const { recentMonths } = recentMonthlyLateCount(
    [
      { coversMonth: '2026-05', paidAt: '2026-05-04' },
      { coversMonth: '2026-06', paidAt: '2026-06-04' },
      { coversMonth: '2026-07', paidAt: '2026-07-04' },
      { coversMonth: '2026-08', paidAt: '2026-08-04' },
    ],
    5,
    'avance',
  );
  assert.deepEqual(recentMonths.map((m) => m.coversMonth), ['2026-08', '2026-07', '2026-06']);
});
