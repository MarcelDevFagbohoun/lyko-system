'use strict';

const { pool } = require('../config/db');
const { UNIT_DESIGNATIONS } = require('../constants/properties');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));

/** Mois suivant au format 'YYYY-MM'. */
function addMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m (non m-1) avance déjà d'un mois
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Refonte de la clôture (étape 2/5, 2026-10-16) : primitives de progression généralisées à un
 * "rythme" de tenant (`{mode: 'calendaire'|'jour_fixe'|'libre', startDay}`, voir
 * `accountingPeriods.getTenantRhythm`) au lieu de toujours supposer un mois civil. `rhythm` est
 * TOUJOURS un paramètre optionnel partout dans ce fichier : omis (ou `{mode:'calendaire'}`), tout
 * se comporte EXACTEMENT comme avant cette étape — aucun appelant existant n'a besoin de changer.
 *
 * Représentation d'une "clé de période" (`periodKey`) : pour un bail calendaire, une étiquette
 * 'AAAA-MM' (inchangé, c'est `covers_month`) ; pour un bail non-calendaire, une date complète
 * 'AAAA-MM-JJ' qui est le DÉBUT de la période (c'est `covers_period_start`). Les deux se comparent/
 * trient correctement en chaîne (préfixe commun 'AAAA-MM') et ne sont jamais mélangées pour un même
 * bail — chaque bail a un rythme fixe pour toute sa durée (celui de son tenant au moment de sa
 * création, voir `leases.rent_due_offset_days` vs `rent_due_day`).
 *
 * `jour_fixe` ET `libre` avancent par le MÊME calcul : un mois plein, ancré sur le jour de la clé
 * de départ elle-même (jamais sur un jour global du tenant) — décision explicite pour `libre`
 * (aucune autre estimation n'est possible sans donnée supplémentaire, et l'imprécision éventuelle
 * ne s'accumule jamais : dès qu'une période `libre` clôture réellement, la suivante repart de la
 * vraie date de fin, voir `accountingPeriods.getOpenPeriodStart` — jamais de cette estimation).
 * Décision assumée : aucune machinerie de réconciliation automatique n'est construite pour ce cas,
 * conformément au choix explicite de l'utilisateur.
 */
function addPeriod(periodStartIso) {
  const d = new Date(`${periodStartIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day));
  return next.toISOString().slice(0, 10);
}

/** Symétrique de `addPeriod` : un mois AVANT, ancré sur le même jour. */
function subPeriod(periodStartIso) {
  const d = new Date(`${periodStartIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, day));
  return prev.toISOString().slice(0, 10);
}

/**
 * Dernier jour (inclus) d'une période identifiée par sa clé — calendaire ('AAAA-MM') : dernier jour
 * du mois ; sinon ('AAAA-MM-JJ') : veille du début de la période suivante. Sert aux libellés
 * « du … au … » (quittance, portail, frise), jamais au calcul du dû.
 */
function periodEndOf(periodKey) {
  if (/^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  const d = new Date(`${addPeriod(periodKey)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Clé de période d'une ligne `rent_payments` (étape 2c) : `covers_month` pour un bail calendaire,
 * `covers_period_start` (date complète) sinon — la même clé que celle du moteur de loyer, pour que
 * toute réponse d'API qui expose `coversMonth` renvoie une valeur exploitable, jamais `null`.
 */
function paymentPeriodKey(row) {
  if (row.covers_month) return row.covers_month;
  return row.covers_period_start ? toIsoDateString(row.covers_period_start) : null;
}

/** Avance d'une période quel que soit le rythme — calendaire retombe sur `addMonth` (inchangé). */
function nextPeriodKey(rhythm, periodKey) {
  return (rhythm?.mode ?? 'calendaire') === 'calendaire' ? addMonth(periodKey) : addPeriod(periodKey);
}

/** Recule d'une période quel que soit le rythme — calendaire retombe sur l'ancien calcul inline. */
function previousPeriodKey(rhythm, periodKey) {
  if ((rhythm?.mode ?? 'calendaire') === 'calendaire') {
    const [y, m] = periodKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return subPeriod(periodKey);
}

/** Recule de `n` périodes — calendaire retombe sur `shiftMonth` (inchangé). */
function stepBackPeriods(rhythm, periodKey, n) {
  if ((rhythm?.mode ?? 'calendaire') === 'calendaire') return shiftMonth(periodKey, -n);
  let key = periodKey;
  for (let i = 0; i < n; i += 1) key = subPeriod(key);
  return key;
}

/**
 * Quelle période (parmi celles de CE bail, ancrées sur son `baselineKey`) contient `todayIso` ?
 * Calendaire : dérivable directement de `todayIso` (inchangé, aucune marche nécessaire). Sinon :
 * marche depuis `baselineKey` — jamais d'accès base, jamais plus de quelques dizaines d'itérations
 * même pour un bail actif depuis des années.
 */
function periodKeyContainingToday(rhythm, baselineKey, todayIso) {
  if ((rhythm?.mode ?? 'calendaire') === 'calendaire') return todayIso.slice(0, 7);
  let key = baselineKey;
  while (nextPeriodKey(rhythm, key) <= todayIso) key = nextPeriodKey(rhythm, key);
  return key;
}

/**
 * Période de la grille d'un bail non-calendaire (ancrée sur `anchorKey`) qui COMMENCE dans le mois
 * civil `yearMonth` ('AAAA-MM') — `null` si aucune (un mois sauté par un ancrage en fin de mois).
 * Marche bornée par l'écart en mois, jamais d'accès base. Sert aux vues découpées par mois civil.
 */
function periodKeyStartingInMonth(rhythm, anchorKey, yearMonth) {
  let key = anchorKey;
  while (key.slice(0, 7) > yearMonth) key = previousPeriodKey(rhythm, key);
  while (key.slice(0, 7) < yearMonth) key = nextPeriodKey(rhythm, key);
  return key.slice(0, 7) === yearMonth ? key : null;
}

/**
 * Résout l'échéance d'un loyer pour la période `periodKey` — fonction UNIQUE qui remplace les
 * anciennes réimplémentations indépendantes du décalage avance/terme_échu dispersées dans
 * `computeArrears`/`isPaymentLate`/`rentMonthState`. Si `rentDueDay` est fourni (bail calendaire,
 * ou bail créé avant cette étape) : calcul IDENTIQUE à avant, byte pour byte. Sinon
 * (`rentDueOffsetDays`, bail créé sous un tenant non-calendaire) : ancre sur `periodKey` (ou sur la
 * période SUIVANTE si `terme_echu`) + un nombre de jours.
 */
function resolveRentDueDate({ rhythm, periodKey, rentDueDay, rentDueOffsetDays, rentTiming }) {
  if (rentDueDay != null) {
    const dueMonth = rentTiming === 'terme_echu' ? addMonth(periodKey) : periodKey;
    const [y, m] = dueMonth.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, rentDueDay)).toISOString().slice(0, 10);
  }
  const base = rentTiming === 'terme_echu' ? addPeriod(periodKey) : periodKey;
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(rentDueOffsetDays));
  return d.toISOString().slice(0, 10);
}

/**
 * Décompose un nombre de jours de retard en mois pleins + jours restants,
 * de façon exacte au calendrier (jamais une simple division par ~30) : le
 * nombre de mois pleins écoulés entre `dueDate` et `todayUtc`, puis le
 * reste en jours. Demande directe de l'utilisateur : au-delà d'un mois de
 * retard, l'information doit d'abord se lire en mois + jours, pas
 * seulement en jours bruts (peu lisible passé quelques dizaines de jours).
 */
function monthsAndDaysLate(dueDate, todayUtc) {
  let months =
    (todayUtc.getUTCFullYear() - dueDate.getUTCFullYear()) * 12 + (todayUtc.getUTCMonth() - dueDate.getUTCMonth());
  if (todayUtc.getUTCDate() < dueDate.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const afterMonths = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + months, dueDate.getUTCDate()));
  const remainderDays = Math.max(0, Math.round((todayUtc - afterMonths) / 86_400_000));
  return { months, remainderDays };
}

/** Date ISO 'AAAA-MM-JJ' à partir d'une chaîne ou d'un objet Date MySQL. */
function toIsoDateString(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Prorata d'entrée (étape 42, demande directe de l'utilisateur, 2026-09-28) — un locataire qui entre
 * en cours de mois (ex. le 25 septembre, échéance le 5) n'a pas vécu tout le mois : sans ce calcul, le
 * cycle mensuel classique le facturerait pour tout le mois, ou (à l'inverse, via `upToDateAtOnboarding`)
 * ne lui facturerait RIEN pour les jours réellement occupés avant la première échéance normale — dans
 * les deux cas, le propriétaire perd de l'argent ou le locataire paie plus que ce qu'il doit.
 *
 * Décisions explicites de l'utilisateur :
 *   - diviseur FORFAITAIRE de 30 jours (jamais les jours réels du mois — montant identique quel que
 *     soit le mois d'entrée, plus simple à expliquer qu'un prorata calendaire) ;
 *   - le montant appartient au PROPRIÉTAIRE (même traitement qu'un loyer : commission du cabinet
 *     prélevée dessus, reste au propriétaire — voir `dette_initiale_encaissee`, un précédent déjà en
 *     place pour un « loyer dû mais réglé hors du cycle mensuel normal ») ;
 *   - libellé « Prorata d'entrée » sur les documents.
 *
 * Payé à la signature (comme la caution et les frais d'agence), jamais différé à la première
 * échéance : ça ne touche donc JAMAIS `computeArrears`/`allocateRentPayment` (déjà audités) — c'est un
 * montant à part, une seule fois, indépendant du cycle mensuel qui démarre ensuite normalement.
 *
 * Refonte de la clôture (étape 2/5) : reste CALENDAIRE UNIQUEMENT (hypothèse `rentDueDay`) — généraliser
 * le prorata d'entrée à un bail non-calendaire (`rentDueOffsetDays`) est hors scope de cette étape,
 * limitation documentée. Un bail non-calendaire avec `entryProration: 'prorata'` démarre son suivi
 * directement à `startDate` (voir `baselineMonthOf` ci-dessous), sans cet ajustement.
 */

/**
 * Première échéance normale à partir de `startDate` INCLUS : la prochaine date portant le jour
 * `rentDueDay`. Une entrée exactement LE jour d'échéance ne produit aucun prorata (0 jour) — c'est le
 * cas normal, pas un cas limite à traiter à part.
 */
function firstRegularDueDate(startDate, rentDueDay) {
  const [y, m] = startDate.split('-').map(Number);
  const sameMonth = toIsoDateString(new Date(Date.UTC(y, m - 1, rentDueDay)));
  const dueDate = sameMonth >= startDate ? sameMonth : toIsoDateString(new Date(Date.UTC(y, m, rentDueDay)));
  return dueDate;
}

/**
 * `{ days, amount, dueDate }` — `days` = nombre de jours occupés avant la première échéance normale
 * (intervalle [startDate, dueDate[, jamais négatif) ; `amount` = loyer mensuel × jours ÷ 30, arrondi au
 * franc. `monthlyRent` à 0 ou absent → prorata nul (bail sans loyer, cas théorique, jamais d'erreur).
 */
function computeEntryProrata({ startDate, monthlyRent, rentDueDay }) {
  const dueDate = firstRegularDueDate(startDate, rentDueDay);
  const days = Math.round((new Date(`${dueDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86_400_000);
  const amount = monthlyRent > 0 ? Math.round((Number(monthlyRent) * days) / 30) : 0;
  return { days, amount, dueDate };
}

/**
 * Premier mois réellement SUIVI pour un bail : le mois du début du bail, ou
 * celui de son enregistrement sur la plateforme s'il est postérieur (le suivi
 * ne remonte jamais avant Lyko System) ; un locataire entré « à jour » démarre le
 * mois d'après. Partagé par le calcul de retard et la frise des mois.
 *
 * Bug corrigé (audit comptable du 30/09/2026) : avec un prorata d'entrée
 * (`entryProration === 'prorata'`), les jours entre `startDate` et la
 * première échéance normale sont DÉJÀ réglés par le prorata, payé à part à
 * la signature (voir `computeEntryProrata` ci-dessus) — le cycle mensuel
 * classique ne doit donc commencer à compter qu'À PARTIR de cette première
 * échéance normale, jamais depuis `startDate` lui-même. Sans ce correctif,
 * un locataire entré le 25 avec échéance le 5 apparaissait « en retard »
 * dès le jour de son emménagement, sur un mois déjà couvert par le prorata.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm` optionnel (calendaire par défaut, inchangé). Pour un
 * bail non-calendaire, la "clé de période" de base est directement `effectiveStartDate` lui-même
 * (une date complète, jamais une étiquette 'AAAA-MM') — chaque bail non-calendaire porte sa PROPRE
 * grille de périodes virtuelles, ancrée sur sa propre date de début, indépendante des périodes
 * comptables réelles du tenant (qui ne servent qu'à la clôture, pas au calcul du loyer dû par bail).
 */
function baselineMonthOf({ startDate, createdAt, upToDateAtOnboarding, entryProration, rentDueDay, rhythm }) {
  const isCalendaire = (rhythm?.mode ?? 'calendaire') === 'calendaire';
  const effectiveStartDate =
    isCalendaire && entryProration === 'prorata' && rentDueDay != null ? firstRegularDueDate(startDate, rentDueDay) : startDate;
  const createdAtIso = createdAt ? toIsoDateString(createdAt) : null;
  const baselineDate = createdAtIso && createdAtIso > effectiveStartDate ? createdAtIso : effectiveStartDate;
  const baselineKey = isCalendaire ? baselineDate.slice(0, 7) : baselineDate;
  return upToDateAtOnboarding ? nextPeriodKey(rhythm, baselineKey) : baselineKey;
}

/**
 * Calcule le statut de paiement d'un bail : mois payés (à partir de la date
 * de début et des paiements enregistrés), prochaine échéance, retard éventuel.
 * `payments` : tableau de { coversMonth: 'YYYY-MM', amount }. `amount` est
 * OPTIONNEL (voir `monthlyRent` ci-dessous) pour ne jamais casser un appelant
 * qui ne le fournirait pas encore.
 *
 * `createdAt` (date d'enregistrement sur la plateforme) et
 * `upToDateAtOnboarding` : corrigent un vrai biais — sans eux, un locataire
 * entré dans les lieux il y a des mois/années mais enregistré aujourd'hui
 * ressortirait comme devant tout ce temps, alors qu'il n'a peut-être jamais
 * manqué un paiement (juste jamais suivi ici). Le suivi ne peut jamais
 * démarrer avant `createdAt` : `startDate` reste le fait historique (contrat,
 * état des lieux) mais seul, sans plafond, il ferait remonter le retard
 * avant même que Lyko System n'existe pour ce bail. `upToDateAtOnboarding`
 * (coché explicitement par l'agent à la création) couvre le dernier résidu :
 * le mois de l'enregistrement lui-même, également considéré couvert.
 * `createdAt` omis (compatibilité) : aucun plafond, comportement historique
 * inchangé.
 *
 * `monthlyRent` (audit comptable du 23/09/2026, anomalie A1) : SANS lui, un
 * mois est considéré réglé dès qu'AU MOINS UNE ligne `rent_payments` existe
 * pour ce mois, quel que soit son montant — un paiement PARTIEL (40000 sur
 * un loyer de 100000) faisait alors avancer `nextDueMonth` exactement comme
 * un paiement complet, effaçant silencieusement pour toujours les 60000
 * restants des calculs d'arriérés. AVEC `monthlyRent` fourni, `nextDueMonth`
 * n'avance que lorsque le CUMUL des paiements d'un mois atteint réellement
 * le loyer dû. `monthlyRent` omis (compatibilité, appelant non encore mis à
 * jour) : comportement historique (buggé) inchangé — ne JAMAIS omettre pour
 * un nouvel appel.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`rentDueOffsetDays` optionnels (calendaire par défaut,
 * inchangé byte pour byte dans ce cas). `payments[i].coversMonth` devient, pour un bail non-calendaire,
 * une date complète (voir le commentaire d'en-tête de fichier) — toujours nommé `coversMonth` pour ne
 * pas multiplier les noms de champs, l'appelant choisit la bonne représentation selon le rythme du bail.
 */
function computeArrears(
  { startDate, createdAt, upToDateAtOnboarding, rentDueDay, rentDueOffsetDays, rentTiming, monthlyRent, payments, entryProration, rhythm },
  today = new Date(),
) {
  const baselineMonth = baselineMonthOf({ startDate, createdAt, upToDateAtOnboarding, entryProration, rentDueDay, rhythm });

  const paidThrough = payments.length > 0 ? payments.map((p) => p.coversMonth).sort().at(-1) : null;

  const rent = monthlyRent != null ? Number(monthlyRent) : null;
  let nextDueMonth;
  let paidForNextDueMonth = 0;
  if (rent != null && rent > 0) {
    const paidByMonth = new Map();
    for (const p of payments) {
      paidByMonth.set(p.coversMonth, (paidByMonth.get(p.coversMonth) ?? 0) + Number(p.amount ?? 0));
    }
    // Avance mois par mois tant que le cumul payé pour CE mois atteint (ou
    // dépasse) le loyer dû — termine forcément vite : au-delà du dernier
    // mois cumulé dans `paidByMonth`, le cumul vaut 0 < rent, la boucle
    // s'arrête donc au plus tard un mois après le dernier paiement connu.
    let month = baselineMonth;
    while ((paidByMonth.get(month) ?? 0) >= rent) {
      month = nextPeriodKey(rhythm, month);
    }
    nextDueMonth = month;
    paidForNextDueMonth = paidByMonth.get(nextDueMonth) ?? 0;
  } else {
    // Comportement historique (compatibilité, `monthlyRent` omis) : présence
    // d'AU MOINS UNE ligne pour un mois = mois considéré réglé, quel que
    // soit son montant réel.
    nextDueMonth = paidThrough && paidThrough >= baselineMonth ? nextPeriodKey(rhythm, paidThrough) : baselineMonth;
  }

  // Convention de paiement (demande directe de l'utilisateur, 2026-09-24) :
  // 'terme_echu' repousse l'échéance au mois SUIVANT celui facturé (le
  // loyer de septembre ne se paie qu'en octobre) — 'avance' (défaut,
  // comportement historique) et l'omission de `rentTiming` restent
  // strictement identiques : l'échéance reste dans le mois facturé lui-même.
  const dueDate = resolveRentDueDate({ rhythm, periodKey: nextDueMonth, rentDueDay, rentDueOffsetDays, rentTiming });
  const [dy, dm, dd] = dueDate.split('-').map(Number);
  const dueDateUtc = new Date(Date.UTC(dy, dm - 1, dd));
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysLate = Math.floor((todayUtc - dueDateUtc) / 86_400_000);
  const { months: monthsLate, remainderDays: remainderDaysLate } =
    daysLate > 0 ? monthsAndDaysLate(dueDateUtc, todayUtc) : { months: 0, remainderDays: 0 };

  // « Payé jusqu'à » : le dernier mois réellement SOLDÉ, de façon consécutive
  // depuis le début du suivi — jamais un mois seulement entamé ni un mois payé
  // après un trou. Avec `monthlyRent`, c'est le mois qui précède `nextDueMonth` ;
  // s'il précède le début du suivi (locataire déjà en place à l'enregistrement),
  // on retombe sur le dernier mois payé AVANT ce début. Sans `monthlyRent`
  // (compatibilité) : dernier mois ayant reçu un paiement, comme avant.
  let paidThroughMonth = paidThrough;
  if (rent != null && rent > 0) {
    const lastSettled = previousPeriodKey(rhythm, nextDueMonth);
    paidThroughMonth =
      lastSettled >= baselineMonth
        ? lastSettled
        : (payments.map((p) => p.coversMonth).filter((mth) => mth < baselineMonth).sort().at(-1) ?? null);
  }

  return {
    paidThroughMonth,
    nextDueMonth,
    // Combien est déjà réglé pour `nextDueMonth` (0 si rien) — permet à
    // `allocateRentPayment` de COMPLÉTER un mois déjà partiellement payé au
    // lieu de repartir de zéro sur ce même mois.
    paidForNextDueMonth,
    dueDate,
    daysLate,
    monthsLate,
    remainderDaysLate,
    status: daysLate > 0 ? 'late' : 'current',
  };
}

/**
 * Répartit un montant total sur des mois de loyer consécutifs à partir de
 * `nextDueMonth` : d'abord le reliquat d'un mois déjà partiellement payé
 * (`alreadyPaidForNextDueMonth`, audit comptable A1 — sans ça, un paiement
 * de complément créerait à tort un NOUVEAU mois plutôt que de compléter
 * celui en cours), puis autant de mois complets que le montant restant le
 * permet, puis le reste éventuel en paiement partiel sur le mois suivant
 * (décision produit : « mois entiers + reste en partiel »). Renvoie la
 * liste des écritures à créer, une par mois (chacune donnera lieu à sa
 * propre quittance) — plusieurs lignes peuvent désormais partager le même
 * `coversMonth` (le complément d'un mois déjà partiel), sciemment : c'est
 * leur SOMME que `computeArrears` compare au loyer, jamais une ligne isolée.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm` optionnel (calendaire par défaut, inchangé).
 */
function allocateRentPayment({ rhythm, nextDueMonth, monthlyRent, alreadyPaidForNextDueMonth = 0, amount }) {
  const rent = Number(monthlyRent);
  let remaining = Number(amount);
  const allocations = [];
  let month = nextDueMonth;

  if (rent > 0) {
    const shortfall = Math.max(0, rent - Number(alreadyPaidForNextDueMonth));
    if (shortfall > 0) {
      const toApply = Math.min(remaining, shortfall);
      if (toApply > 0) {
        allocations.push({ coversMonth: month, amount: toApply, isPartial: toApply < shortfall });
        remaining -= toApply;
      }
      if (toApply < shortfall) {
        // Montant épuisé avant d'avoir complété même ce premier mois.
        return { fullMonths: 0, partialAmount: 0, monthsCovered: allocations.length, allocations };
      }
      month = nextPeriodKey(rhythm, month);
    }
  }

  const fullMonths = rent > 0 ? Math.floor(remaining / rent) : 0;
  const partialAmount = rent > 0 ? remaining % rent : remaining;
  for (let i = 0; i < fullMonths; i += 1) {
    allocations.push({ coversMonth: month, amount: rent, isPartial: false });
    month = nextPeriodKey(rhythm, month);
  }
  if (partialAmount > 0) {
    allocations.push({ coversMonth: month, amount: partialAmount, isPartial: true });
  }
  return { fullMonths, partialAmount, monthsCovered: allocations.length, allocations };
}

/** Nombre de mois entre deux 'AAAA-MM' inclus (>= 1 si `to` >= `from`). */
function monthsBetweenInclusive(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Généralisation de `monthsBetweenInclusive` à un rythme quelconque — calendaire retombe sur le
 * calcul arithmétique direct (inchangé, rapide) ; sinon, marche pas à pas (listes courtes en
 * pratique, jamais un souci de performance réel).
 */
function periodsBetweenInclusive(rhythm, fromKey, toKey) {
  if ((rhythm?.mode ?? 'calendaire') === 'calendaire') return monthsBetweenInclusive(fromKey, toKey);
  let count = 1;
  let key = fromKey;
  while (key < toKey) {
    key = nextPeriodKey(rhythm, key);
    count += 1;
  }
  return count;
}

/**
 * Un paiement a-t-il été réglé APRÈS l'échéance de son propre mois (même
 * convention que `computeArrears` : le jour de l'échéance lui-même n'est pas
 * en retard, seulement le lendemain) ? `paidAt` peut être un objet `Date`
 * (colonne DATE MySQL) ou une chaîne 'AAAA-MM-JJ'. `rentTiming` (voir
 * `computeArrears`) : 'terme_echu' repousse l'échéance au mois suivant.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`rentDueOffsetDays` ajoutés en fin de liste
 * (paramètres positionnels existants inchangés, donc tout appel existant reste identique).
 */
function isPaymentLate(coversMonth, rentDueDay, paidAt, rentTiming, rhythm, rentDueOffsetDays) {
  const dueDate = resolveRentDueDate({ rhythm, periodKey: coversMonth, rentDueDay, rentDueOffsetDays, rentTiming });
  const [y, m, d] = dueDate.split('-').map(Number);
  const dueDateUtc = new Date(Date.UTC(y, m - 1, d));
  const paid = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const paidUtc = new Date(Date.UTC(paid.getUTCFullYear(), paid.getUTCMonth(), paid.getUTCDate()));
  return paidUtc > dueDateUtc;
}

/**
 * Parmi `payments` (`{coversMonth, paidAt}`, un versement = une ligne), les 3 derniers MOIS COUVERTS
 * DISTINCTS les plus récents et le nombre de ces mois réglés en retard — jamais un simple décompte de
 * versements bruts. Fonction PURE (aucun accès base), extraite pour `listPredictiveLateAlerts`.
 *
 * Bug corrigé (étape 51bis, Moyenne #8) : `allocateRentPayment` autorise plusieurs versements pour le
 * MÊME `coversMonth` (règlement partiel, puis complément plus tard — voir son propre commentaire). Sans
 * cette agrégation par mois, un seul mois réglé en deux fois comptait pour 2 « retards » distincts dans
 * `lateCount`, déclenchant à tort une alerte de « retard récurrent » sur la base d'un SEUL évènement réel
 * — contraire à la règle documentée (« au moins 2 des 3 derniers MOIS »). La date retenue pour juger un
 * mois en retard est celle du DERNIER versement qui l'a soldé : un mois payé en partie à temps puis
 * complété en retard n'a pas été réglé à temps.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`rentDueOffsetDays` optionnels, ajoutés en fin de liste.
 */
function recentMonthlyLateCount(payments, rentDueDay, rentTiming, rhythm, rentDueOffsetDays) {
  const latestPaymentByMonth = new Map();
  for (const p of payments) {
    const current = latestPaymentByMonth.get(p.coversMonth);
    if (!current || new Date(p.paidAt) > new Date(current.paidAt)) {
      latestPaymentByMonth.set(p.coversMonth, p);
    }
  }
  const recentMonths = [...latestPaymentByMonth.values()]
    .sort((a, b) => (a.coversMonth < b.coversMonth ? 1 : -1))
    .slice(0, 3);
  const lateCount = recentMonths.filter((p) => isPaymentLate(p.coversMonth, rentDueDay, p.paidAt, rentTiming, rhythm, rentDueOffsetDays)).length;
  return { recentMonths, lateCount };
}

/**
 * Liste tous les baux actifs en retard de paiement pour l'ensemble du
 * portefeuille d'un tenant (pas seulement une période) — utilisée par le
 * tableau de bord comptable (étape 8, impayés locataires) et le centre de
 * relance groupée (étape 10). Le montant dû reste une estimation calculée
 * automatiquement (mois dus × loyer), jamais une saisie.
 *
 * `scopeAgentId` (étape 14) : un agent restreint ne voit que les impayés des
 * baux sur un Bien qui lui est attribué — voir services/scope.js.
 *
 * Refonte de la clôture (étape 2/5) : charge le rythme du tenant UNE FOIS (`getTenantRhythm`,
 * `accountingPeriods.js`) et le propage à chaque bail — import différé (pas en tête de fichier) pour
 * éviter tout risque de dépendance circulaire avec `accountingPeriods.js`, qui n'importe rien de ce
 * fichier aujourd'hui mais reste un service de bas niveau à ne jamais coupler en dur.
 */
/**
 * Loyer en retard dû par UN bail, à une date donnée (`asOfDate`, par défaut aujourd'hui) — extrait
 * de `listPortfolioArrears` (demande utilisateur, 2026-10-18 : régler les arriérés via la caution à
 * la sortie d'un locataire doit utiliser EXACTEMENT le même calcul que ce qui s'affiche comme
 * « impayé » sur le tableau de bord/les relances, jamais une variante légèrement différente qui
 * laisserait les deux désaccord). `payments` déjà filtrées sur ce bail, `rhythm` du tenant.
 */
function computeRentOwed({ lease, payments, rhythm, asOfDate = null }) {
  const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
  const today = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : new Date();
  const arrears = computeArrears(
    {
      startDate,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      rentDueOffsetDays: lease.rent_due_offset_days,
      rentTiming: lease.rent_timing,
      monthlyRent: lease.monthly_rent,
      entryProration: lease.entry_proration,
      payments,
      rhythm,
    },
    today,
  );
  if (arrears.status !== 'late') return { arrears, unpaidMonths: 0, rentOwed: 0 };

  const todayIso = today.toISOString().slice(0, 10);
  const baselineKey = baselineMonthOf({
    startDate,
    createdAt: lease.created_at,
    upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
    entryProration: lease.entry_proration,
    rentDueDay: lease.rent_due_day,
    rhythm,
  });
  const currentKey = periodKeyContainingToday(rhythm, baselineKey, todayIso);
  const unpaidMonths = Math.max(1, periodsBetweenInclusive(rhythm, arrears.nextDueMonth, currentKey));
  // Audit comptable, anomalie A1 : le mois en cours (`nextDueMonth`) peut déjà être partiellement
  // réglé (`paidForNextDueMonth`) — ne jamais compter le loyer plein de ce mois sans en déduire ce
  // qui est déjà payé, sous peine de facturer deux fois le même reliquat.
  const rentOwed = Math.max(0, unpaidMonths * Number(lease.monthly_rent) - arrears.paidForNextDueMonth);
  return { arrears, unpaidMonths, rentOwed };
}

/**
 * `asOfDate` ('AAAA-MM-JJ', défaut null = aujourd'hui) : reconstruit le point des impayés tel qu'il était
 * à cette date (fin d'un mois passé) — seuls comptent les baux déjà démarrés et encore en cours à cette
 * date, les paiements/règlements faits au plus tard ce jour-là, et les pénalités déjà appliquées.
 */
async function listPortfolioArrears(tenantId, scopeAgentId = null, asOfDate = null) {
  const { getTenantRhythm } = require('./accountingPeriods');
  const rhythm = await getTenantRhythm(tenantId);
  const isCalendaire = rhythm.mode === 'calendaire';

  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  // Bail « en cours » : actif aujourd'hui, ou (reconstruction) démarré avant la date et pas encore terminé.
  let leaseStatusClause = "l.status = 'active'";
  if (asOfDate) {
    leaseStatusClause = 'l.start_date <= :asOfDate AND (l.end_date IS NULL OR l.end_date >= :asOfDate)';
    params.asOfDate = asOfDate;
  }
  const paidBy = (col) => (asOfDate ? ` AND ${col} <= '${asOfDate}'` : '');
  const [activeLeases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_due_offset_days, l.rent_timing, l.opening_debt_amount,
            l.created_at, l.up_to_date_at_onboarding, l.entry_proration,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE l.tenant_id = :tenantId AND ${leaseStatusClause} ${scopeClause}`,
    params,
  );
  if (activeLeases.length === 0) return [];

  const leaseIds = activeLeases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL${paidBy('paid_at')}`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    const coversMonth = isCalendaire ? p.covers_month : toIsoDateString(p.covers_period_start);
    paymentsByLease.get(p.lease_id).push({ coversMonth, amount: Number(p.amount) });
  }

  const [openingDebtPaid] = await pool.query(
    `SELECT lease_id, SUM(amount) AS paid FROM lease_opening_debt_payments WHERE lease_id IN (${placeholders})${paidBy('paid_at')} GROUP BY lease_id`,
    leaseIds,
  );
  const openingDebtPaidByLease = new Map(openingDebtPaid.map((r) => [r.lease_id, Number(r.paid)]));

  // Pénalités de retard non réglées (étape 44bis) — même principe que la dette initiale ci-dessus :
  // solde restant = montants appliqués moins ce qui a déjà été réglé, sommé par bail (un bail peut avoir
  // plusieurs pénalités, chacune payable indépendamment — voir `late_fee_payments`).
  const [lateFeesApplied] = await pool.query(
    `SELECT lease_id, SUM(amount) AS applied FROM late_fees WHERE lease_id IN (${placeholders})${paidBy('applied_at')} GROUP BY lease_id`,
    leaseIds,
  );
  const [lateFeesPaid] = await pool.query(
    `SELECT lf.lease_id, SUM(lfp.amount) AS paid
     FROM late_fee_payments lfp JOIN late_fees lf ON lf.id = lfp.late_fee_id
     WHERE lf.lease_id IN (${placeholders})${paidBy('lfp.paid_at')} GROUP BY lf.lease_id`,
    leaseIds,
  );
  const lateFeesAppliedByLease = new Map(lateFeesApplied.map((r) => [r.lease_id, Number(r.applied)]));
  const lateFeesPaidByLease = new Map(lateFeesPaid.map((r) => [r.lease_id, Number(r.paid)]));

  const results = [];
  for (const lease of activeLeases) {
    const { arrears, unpaidMonths, rentOwed } = computeRentOwed({
      lease,
      payments: paymentsByLease.get(lease.id) || [],
      rhythm,
      asOfDate,
    });
    const openingDebtRemaining = Number(lease.opening_debt_amount) - (openingDebtPaidByLease.get(lease.id) || 0);
    const lateFeesRemaining = (lateFeesAppliedByLease.get(lease.id) || 0) - (lateFeesPaidByLease.get(lease.id) || 0);
    // Un bail peut devoir de l'argent pour TROIS raisons indépendantes : du
    // loyer en retard (calculé au jour près), un reliquat de dette initiale
    // jamais soldé (onboarding), et/ou une pénalité de retard non réglée —
    // aucune n'empêche les autres d'apparaître dans la liste de relance.
    if (arrears.status === 'late' || openingDebtRemaining > 0 || lateFeesRemaining > 0) {
      results.push({
        leaseId: lease.id,
        renterId: lease.renter_id,
        renterName: `${lease.first_name} ${lease.last_name}`,
        phone: lease.phone,
        unitCode: lease.unit_code,
        propertyCode: lease.property_code,
        monthlyRent: Number(lease.monthly_rent),
        dueDate: arrears.dueDate,
        daysLate: arrears.daysLate,
        unpaidMonths,
        openingDebtRemaining,
        lateFeesRemaining,
        amountOwed: rentOwed + openingDebtRemaining + lateFeesRemaining,
      });
    }
  }
  return results;
}

/**
 * Fige, pour chaque bail actif pendant la période `[periodStart, periodEnd]` clôturée, le montant
 * dû à cet instant (loyers en retard + reliquat de dette initiale non
 * soldé) dans `lease_balance_snapshots` — décision explicite de
 * l'utilisateur : une période clôturée ne doit jamais changer de réponse à « que
 * devait-il à cette date-là », même si `computeArrears` évolue plus tard.
 * INSERT-only, appelé une seule fois par `POST /api/accounting/periods`
 * juste après la clôture — la contrainte UNIQUE (tenant_id, period_start,
 * lease_id) protège aussi contre un double appel accidentel.
 *
 * Portée des baux : même critère que `getPeriodClosability`
 * (`accountingPeriods.js`) — chevauche la période, actif ou déjà terminé,
 * jamais seulement `status = 'active'` (un bail terminé en cours de mois
 * devait encore quelque chose au moment de la clôture).
 *
 * Refonte de la clôture (étape 2/5) : prend désormais `rhythm` + les bornes RÉELLES déjà calculées
 * par la route de clôture (`periodStart`/`periodEnd`), au lieu de dériver un mois civil depuis une
 * chaîne 'AAAA-MM' — fonctionne pour tout rythme, plus seulement calendaire. `period` (étiquette
 * 'AAAA-MM') reste renseignée pour affichage/compatibilité seulement en rythme calendaire.
 */
async function snapshotLeaseBalances(tenantId, rhythm, periodStart, periodEnd) {
  const isCalendaire = (rhythm?.mode ?? 'calendaire') === 'calendaire';
  const first = periodStart;
  const last = periodEnd;
  const legacyPeriod = isCalendaire ? first.slice(0, 7) : null;

  const [leases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_due_offset_days, l.rent_timing, l.opening_debt_amount,
            l.created_at, l.up_to_date_at_onboarding, l.entry_proration
     FROM leases l
     WHERE l.tenant_id = :tenantId AND l.start_date <= :last AND (l.end_date IS NULL OR l.end_date >= :first)`,
    { tenantId, first, last },
  );
  if (leases.length === 0) return;

  const leaseIds = leases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    const coversMonth = isCalendaire ? p.covers_month : toIsoDateString(p.covers_period_start);
    paymentsByLease.get(p.lease_id).push({ coversMonth, amount: Number(p.amount) });
  }
  const [openingDebtPaid] = await pool.query(
    `SELECT lease_id, SUM(amount) AS paid FROM lease_opening_debt_payments WHERE lease_id IN (${placeholders}) GROUP BY lease_id`,
    leaseIds,
  );
  const openingDebtPaidByLease = new Map(openingDebtPaid.map((r) => [r.lease_id, Number(r.paid)]));

  // Bug corrigé (audit fermeture du mois, point 6, 16/10/2026) : ce figement doit répondre à « que
  // devait-il à la fin DE LA PÉRIODE QU'ON FERME » (voir le commentaire de fonction ci-dessus), pas « que
  // doit-il AUJOURD'HUI » — `computeArrears` prend par défaut la date système réelle (`today`). Closing
  // n'étant jamais obligatoirement séquentiel ni prompt (une période peut être clôturée bien après coup,
  // voir `getPeriodClosability`), cela gonflait l'arriéré figé de tout le temps écoulé entre `periodEnd`
  // et aujourd'hui — faux exactement dans le cas (clôture tardive) où un instantané fidèle compte le plus.
  const asOfPeriodEnd = new Date(`${last}T00:00:00Z`);
  const periodKeyForCount = isCalendaire ? legacyPeriod : first;
  const rows = leases.map((lease) => {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const arrears = computeArrears(
      {
        startDate,
        createdAt: lease.created_at,
        upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
        rentDueDay: lease.rent_due_day,
        rentDueOffsetDays: lease.rent_due_offset_days,
        rentTiming: lease.rent_timing,
        monthlyRent: lease.monthly_rent,
        entryProration: lease.entry_proration,
        payments: paymentsByLease.get(lease.id) || [],
        rhythm,
      },
      asOfPeriodEnd,
    );
    const unpaidMonths =
      arrears.status === 'late' ? Math.max(1, periodsBetweenInclusive(rhythm, arrears.nextDueMonth, periodKeyForCount)) : 0;
    const openingDebtRemaining = Math.max(0, Number(lease.opening_debt_amount) - (openingDebtPaidByLease.get(lease.id) || 0));
    const rentDue = Math.max(0, unpaidMonths * Number(lease.monthly_rent) - arrears.paidForNextDueMonth);
    const amountDue = rentDue + openingDebtRemaining;
    return [tenantId, legacyPeriod, first, last, lease.id, amountDue];
  });

  await pool.query(
    'INSERT INTO lease_balance_snapshots (tenant_id, period, period_start, period_end, lease_id, amount_due) VALUES ?',
    [rows],
  );
}

/**
 * Alertes PRÉDICTIVES de retard (étape 13, idée n°4) : baux actuellement À
 * JOUR (jamais un doublon avec `listPortfolioArrears`, qui couvre le retard
 * déjà là) dont l'échéance à venir tombe dans les `daysAhead` prochains
 * jours ET dont l'historique de paiement montre un motif de retard
 * récurrent — pour relancer AVANT que le retard n'arrive, pas seulement
 * après.
 *
 * Règle retenue (aucune ne s'imposait, décision produit) : au moins 2 des 3
 * derniers mois RÉELLEMENT payés ont été réglés après leur propre échéance.
 * Il faut au moins 2 paiements dans l'historique pour se prononcer — jamais
 * d'alerte sur un locataire trop récent faute de recul.
 *
 * `scopeAgentId` (étape 14) : même portée que `listPortfolioArrears`.
 *
 * Refonte de la clôture (étape 2/5) : même traitement que `listPortfolioArrears` (rythme chargé une
 * fois, propagé à chaque bail).
 */
async function listPredictiveLateAlerts(tenantId, scopeAgentId = null, daysAhead = 5) {
  const { getTenantRhythm } = require('./accountingPeriods');
  const rhythm = await getTenantRhythm(tenantId);
  const isCalendaire = rhythm.mode === 'calendaire';

  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [activeLeases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_due_offset_days, l.rent_timing,
            l.created_at, l.up_to_date_at_onboarding, l.entry_proration,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE l.tenant_id = :tenantId AND l.status = 'active' ${scopeClause}`,
    params,
  );
  if (activeLeases.length === 0) return [];

  const leaseIds = activeLeases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, covers_period_start, amount, paid_at FROM rent_payments
     WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY COALESCE(covers_period_start, STR_TO_DATE(CONCAT(covers_month,'-01'), '%Y-%m-%d')) DESC`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    paymentsByLease.get(p.lease_id).push(p);
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const results = [];
  for (const lease of activeLeases) {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const leasePayments = paymentsByLease.get(lease.id) || [];
    const mappedPayments = leasePayments.map((p) => ({
      coversMonth: isCalendaire ? p.covers_month : toIsoDateString(p.covers_period_start),
      amount: Number(p.amount),
      paidAt: p.paid_at,
    }));
    const arrears = computeArrears({
      startDate,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      rentDueOffsetDays: lease.rent_due_offset_days,
      rentTiming: lease.rent_timing,
      monthlyRent: lease.monthly_rent,
      entryProration: lease.entry_proration,
      payments: mappedPayments,
      rhythm,
    });

    // Déjà couvert par `listPortfolioArrears` : une alerte prédictive n'a de
    // sens que tant que l'échéance n'est pas encore dépassée.
    if (arrears.status === 'late') continue;

    const [dy, dm, dd] = arrears.dueDate.split('-').map(Number);
    const dueDateUtc = new Date(Date.UTC(dy, dm - 1, dd));
    const daysUntilDue = Math.round((dueDateUtc - todayUtc) / 86_400_000);
    if (daysUntilDue > daysAhead) continue;

    const { recentMonths, lateCount } = recentMonthlyLateCount(
      mappedPayments,
      lease.rent_due_day,
      lease.rent_timing,
      rhythm,
      lease.rent_due_offset_days,
    );
    if (recentMonths.length < 2) continue;
    if (lateCount < 2) continue;

    results.push({
      leaseId: lease.id,
      renterId: lease.renter_id,
      renterName: `${lease.first_name} ${lease.last_name}`,
      phone: lease.phone,
      unitCode: lease.unit_code,
      propertyCode: lease.property_code,
      monthlyRent: Number(lease.monthly_rent),
      dueDate: arrears.dueDate,
      daysUntilDue,
      lateCount,
      recentPaymentsCount: recentMonths.length,
    });
  }
  // Échéance la plus proche en premier — la plus urgente à relancer.
  results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return results;
}

/** Mois décalé de `delta` mois au format 'YYYY-MM' (delta négatif accepté). */
function shiftMonth(yearMonth, delta) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * État d'UNE période de loyer pour UN bail — la règle unique derrière la frise des
 * 12 mois et l'encadré « Ce mois-ci ». `paid` = cumul payé pour cette période.
 * Renvoie { status, late, dueDate } ; statuts documentés sur `buildRentStrip`.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`rentDueOffsetDays`/`currentPeriodKey` optionnels.
 * `currentPeriodKey` : en calendaire, dérivable directement de `todayIso` (inchangé, l'appelant ne
 * le fournit jamais) ; sinon, c'est l'APPELANT qui le résout (jamais cette fonction, qui reste pure)
 * via `periodKeyContainingToday` — voir `buildRentStrip`.
 */
function rentMonthState(
  { month, paid, rent, rentDueDay, rentDueOffsetDays, rentTiming, startMonth, endMonth, baselineMonth, rhythm, currentPeriodKey },
  todayIso,
) {
  const currentMonth = currentPeriodKey ?? todayIso.slice(0, 7);
  const dueDate = resolveRentDueDate({ rhythm, periodKey: month, rentDueDay, rentDueOffsetDays, rentTiming });
  const overdue = todayIso > dueDate;

  let status;
  let late = false;
  if (rent > 0 && paid >= rent) {
    status = 'paye';
  } else if (paid > 0) {
    status = 'partiel';
    late = month >= baselineMonth && overdue;
  } else if (month < startMonth || (endMonth && month > endMonth)) {
    status = 'hors_bail';
  } else if (month < baselineMonth) {
    status = 'avant_suivi';
  } else if (overdue) {
    status = 'en_retard';
    late = true;
  } else if (month <= currentMonth) {
    status = 'a_payer';
  } else {
    status = 'a_venir';
  }
  return { status, late, dueDate };
}

// Fenêtre de la frise : 12 mois consécutifs — 8 mois passés, le mois en cours,
// puis 3 mois à venir (les paiements d'avance se voient, l'échéance qui approche aussi).
const STRIP_MONTHS_BEFORE = 8;
const STRIP_MONTHS = 12;

/**
 * Frise des 12 "mois" (périodes) d'un bail (« qui est à jour ? » d'un coup d'œil) : l'état
 * de CHAQUE période, calculé période par période à partir des paiements — jamais
 * déduit de la seule prochaine échéance, pour qu'une période payée après un trou,
 * ou seulement entamée, reste lisible.
 *
 *  - paye         : le cumul payé pour cette période atteint le loyer
 *  - partiel      : payé en partie (`late` dit si l'échéance est passée)
 *  - en_retard    : rien payé et échéance dépassée
 *  - a_payer      : période en cours (ou passée) rien payé, échéance pas encore passée
 *  - a_venir      : période future, rien payé
 *  - avant_suivi  : le bail existait mais Lyko System ne le suivait pas encore
 *  - hors_bail    : avant le début ou après la fin du bail
 *
 * L'échéance suit la convention du bail (`rentTiming`) exactement comme
 * `computeArrears` : à terme échu, le loyer d'une période est dû la période suivante.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`rentDueOffsetDays` optionnels (calendaire par
 * défaut, comportement byte pour byte inchangé dans ce cas — `currentMonth`/`firstMonth` restent
 * dérivés directement de `todayIso` via `shiftMonth`, exactement comme avant). Pour un bail
 * non-calendaire, "la période courante" n'est pas dérivable de la seule date du jour (pas d'ancre
 * globale) : elle se trouve en marchant depuis la base propre à CE bail (`periodKeyContainingToday`,
 * jamais d'accès base).
 */
function buildRentStrip(
  { startDate, endDate, createdAt, upToDateAtOnboarding, rentDueDay, rentDueOffsetDays, rentTiming, monthlyRent, payments, entryProration, rhythm },
  today = new Date(),
) {
  const isCalendaire = (rhythm?.mode ?? 'calendaire') === 'calendaire';
  const rent = Number(monthlyRent) || 0;
  const todayIso = today.toISOString().slice(0, 10);
  const startMonth = isCalendaire ? toIsoDateString(startDate).slice(0, 7) : toIsoDateString(startDate);
  const endMonth = endDate ? (isCalendaire ? toIsoDateString(endDate).slice(0, 7) : toIsoDateString(endDate)) : null;
  const baselineMonth = baselineMonthOf({
    startDate: toIsoDateString(startDate),
    createdAt,
    upToDateAtOnboarding,
    entryProration,
    rentDueDay,
    rhythm,
  });

  const paidByMonth = new Map();
  for (const p of payments) {
    paidByMonth.set(p.coversMonth, (paidByMonth.get(p.coversMonth) ?? 0) + Number(p.amount ?? 0));
  }

  const currentMonth = isCalendaire ? todayIso.slice(0, 7) : periodKeyContainingToday(rhythm, baselineMonth, todayIso);
  const firstMonth = stepBackPeriods(rhythm, currentMonth, STRIP_MONTHS_BEFORE);
  const months = [];
  let month = firstMonth;
  for (let i = 0; i < STRIP_MONTHS; i += 1) {
    const paid = paidByMonth.get(month) ?? 0;
    const state = rentMonthState(
      { month, paid, rent, rentDueDay, rentDueOffsetDays, rentTiming, startMonth, endMonth, baselineMonth, rhythm, currentPeriodKey: currentMonth },
      todayIso,
    );
    months.push({
      month,
      status: state.status,
      paid,
      due: rent,
      remaining: Math.max(0, rent - paid),
      dueDate: state.dueDate,
      late: state.late,
      isCurrent: month === currentMonth,
    });
    month = nextPeriodKey(rhythm, month);
  }
  return months;
}

/**
 * Loyers d'un mois donné, tous baux confondus (encadré « Ce mois-ci ») :
 * attendu, encaissé, reste — et parmi le reste, ce qui est déjà en retard
 * (échéance passée) et ce qui n'est pas encore dû. Même règle par bail que la
 * frise (`rentMonthState`) : un bail n'entre dans l'attendu que si le mois le
 * concerne (ni hors bail, ni antérieur au suivi). `leases[i].paid` = cumul
 * payé pour CE mois de loyer. Invariant : attendu = encaissé + reste.
 *
 * Refonte de la clôture (étape 2/5) : `rhythm`/`currentPeriodKey` optionnels, ajoutés en fin de
 * liste de paramètres — comportement byte pour byte inchangé quand omis pour un bail calendaire.
 *
 * Étape 2c : sans `rhythm`, chaque bail est évalué selon SON rythme (dérivé de ses colonnes, comme
 * partout ailleurs). Un bail non-calendaire dans ce récapitulatif par mois civil est compté pour la
 * période de SA grille qui COMMENCE dans `month` (`leases[i].paid` = cumul payé pour cette
 * période) — avant cette étape, un seul bail de ce type faisait planter tout le récapitulatif
 * (échéance calculée sur un `rentDueDay` absent).
 */
/**
 * État d'UN bail pour un mois donné — extrait de `summarizeRentMonth` (étape « point financier par
 * locataire sur un mois clôturé », 2026-10-18) pour être partagé avec `listRentMonthDetails`
 * ci-dessous, sans dupliquer ni risquer de faire diverger ce calcul déjà éprouvé. `null` = ce bail
 * est hors champ pour ce mois (pas encore commencé / avant suivi), même filtre qu'avant.
 */
function computeLeaseMonthState(lease, month, todayIso, rhythm, currentPeriodKey) {
  const rent = Number(lease.monthlyRent) || 0;
  const paid = Number(lease.paid) || 0;
  const startDate = toIsoDateString(lease.startDate);
  const leaseRhythm = rhythm ?? { mode: lease.rentDueDay != null ? 'calendaire' : 'jour_fixe' };
  const isCalendaire = leaseRhythm.mode === 'calendaire';
  const baselineMonth = baselineMonthOf({
    startDate,
    createdAt: lease.createdAt,
    upToDateAtOnboarding: lease.upToDateAtOnboarding,
    entryProration: lease.entryProration,
    rentDueDay: lease.rentDueDay,
    rhythm: leaseRhythm,
  });
  let periodKey = month;
  let leaseCurrentKey = currentPeriodKey;
  if (!isCalendaire && /^\d{4}-\d{2}$/.test(month)) {
    periodKey = periodKeyStartingInMonth(leaseRhythm, baselineMonth, month);
    if (!periodKey) return null;
    leaseCurrentKey = periodKeyContainingToday(leaseRhythm, baselineMonth, todayIso);
  }
  const state = rentMonthState(
    {
      month: periodKey,
      paid,
      rent,
      rentDueDay: lease.rentDueDay,
      rentDueOffsetDays: lease.rentDueOffsetDays,
      rentTiming: lease.rentTiming,
      startMonth: isCalendaire ? startDate.slice(0, 7) : startDate,
      endMonth: lease.endDate ? (isCalendaire ? toIsoDateString(lease.endDate).slice(0, 7) : toIsoDateString(lease.endDate)) : null,
      baselineMonth,
      rhythm: leaseRhythm,
      currentPeriodKey: leaseCurrentKey,
    },
    todayIso,
  );
  if (state.status === 'hors_bail' || state.status === 'avant_suivi') return null;
  const remaining = Math.max(0, rent - paid);
  return { rent, paid, remaining, status: state.status, late: state.late };
}

function summarizeRentMonth(leases, month, today = new Date(), rhythm, currentPeriodKey) {
  const todayIso = today.toISOString().slice(0, 10);
  const out = {
    month,
    expected: 0,
    collected: 0,
    remaining: 0,
    lateRemaining: 0,
    upcomingRemaining: 0,
    counts: { leases: 0, paye: 0, partiel: 0, en_retard: 0, a_payer: 0, a_venir: 0, late: 0 },
  };
  for (const lease of leases) {
    const result = computeLeaseMonthState(lease, month, todayIso, rhythm, currentPeriodKey);
    if (!result) continue;
    out.counts.leases += 1;
    out.counts[result.status] += 1;
    if (result.late) out.counts.late += 1;
    out.expected += result.rent;
    out.remaining += result.remaining;
    out.collected += result.rent - result.remaining;
    if (result.late) out.lateRemaining += result.remaining;
    else out.upcomingRemaining += result.remaining;
  }
  return out;
}

/**
 * Détail PAR LOCATAIRE du récapitulatif « Loyers du mois » (étape « point financier par locataire
 * sur un mois clôturé », demande utilisateur 2026-10-18) — même calcul que `summarizeRentMonth`
 * (partage `computeLeaseMonthState`), mais une ligne par bail plutôt qu'un total agrégé. `leases`
 * porte ici en plus l'identité (nom du locataire, unité, bien) à simplement reporter sur chaque ligne.
 */
function listRentMonthDetails(leases, month, today = new Date(), rhythm, currentPeriodKey) {
  const todayIso = today.toISOString().slice(0, 10);
  const out = [];
  for (const lease of leases) {
    const result = computeLeaseMonthState(lease, month, todayIso, rhythm, currentPeriodKey);
    if (!result) continue;
    out.push({
      leaseId: lease.id,
      renterId: lease.renterId,
      renterName: lease.renterName,
      unitLabel: lease.unitLabel,
      propertyLabel: lease.propertyLabel,
      monthlyRent: result.rent,
      paid: result.paid,
      remaining: result.remaining,
      status: result.status,
      late: result.late,
    });
  }
  // Les plus préoccupants en premier : en retard, puis partiel, puis à payer, le reste ensuite —
  // jamais un ordre arbitraire pour une liste que le DG lit justement pour repérer les problèmes.
  const STATUS_ORDER = { en_retard: 0, partiel: 1, a_payer: 2, a_venir: 3, paye: 4 };
  out.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  return out;
}

/**
 * Récapitulatif « Loyers du mois » d'un mois civil (attendu, encaissé, reste, en retard) — partagé
 * par `GET /api/accounting/rent-month` et la liste de vérifications de la clôture
 * (`services/closingOverview.js`). `scopeAgentId` : portée « Biens gérés » d'un agent restreint, `null`
 * pour tout le portefeuille.
 */
async function computeRentMonthSummary(tenantId, month, scopeAgentId = null) {
  const [y, m] = month.split('-').map(Number);
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const params = { tenantId, month, firstDay, lastDay };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  // Encaissé lu par date de début de période (étape 2c) : 'AAAA-MM-01' pour un bail calendaire
  // (identique à `covers_month = :month`), la période qui commence dans ce mois pour un bail
  // non-calendaire (voir `summarizeRentMonth`).
  const [leases] = await pool.query(
    `SELECT l.start_date, l.end_date, l.created_at, l.up_to_date_at_onboarding, l.rent_due_day, l.rent_due_offset_days,
            l.rent_timing, l.monthly_rent, l.entry_proration, COALESCE(pay.paid, 0) AS paid
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     LEFT JOIN (
       SELECT lease_id, SUM(amount) AS paid FROM rent_payments
       WHERE covers_period_start BETWEEN :firstDay AND :lastDay AND deleted_at IS NULL GROUP BY lease_id
     ) pay ON pay.lease_id = l.id
     WHERE l.tenant_id = :tenantId AND l.start_date <= :lastDay
       AND (l.status = 'active' OR (l.end_date IS NOT NULL AND l.end_date >= :firstDay)) ${scopeClause}`,
    params,
  );
  return summarizeRentMonth(
    leases.map((l) => ({
      startDate: l.start_date,
      endDate: l.end_date,
      createdAt: l.created_at,
      upToDateAtOnboarding: !!l.up_to_date_at_onboarding,
      rentDueDay: l.rent_due_day,
      rentDueOffsetDays: l.rent_due_offset_days,
      rentTiming: l.rent_timing,
      monthlyRent: Number(l.monthly_rent),
      entryProration: l.entry_proration,
      paid: Number(l.paid),
    })),
    month,
  );
}

/**
 * Point financier de CHAQUE locataire pour un mois (étape clôture, demande utilisateur
 * 2026-10-18 : « lorsqu'on clique sur le mois clôturé, le point financier de chaque locataire dans
 * ce mois-là ») — même requête que `computeRentMonthSummary`, avec en plus l'identité (locataire,
 * unité, bien) nécessaire pour en faire une liste plutôt qu'un total. Fonctionne pour n'importe quel
 * mois, pas seulement un mois clôturé : un mois déjà clôturé ne peut plus recevoir de paiement
 * rétroactif (période fermée), donc son résultat y est de toute façon figé — nul besoin de relire
 * `lease_balance_snapshots` (qui ne garde qu'un solde d'impayés cumulé, pas le détail par mois).
 */
async function listRentMonthRenters(tenantId, month, scopeAgentId = null) {
  const [y, m] = month.split('-').map(Number);
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const params = { tenantId, month, firstDay, lastDay };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [leases] = await pool.query(
    `SELECT l.id, l.start_date, l.end_date, l.created_at, l.up_to_date_at_onboarding, l.rent_due_day, l.rent_due_offset_days,
            l.rent_timing, l.monthly_rent, l.entry_proration, COALESCE(pay.paid, 0) AS paid,
            r.id AS renter_id, r.first_name, r.last_name,
            u.code AS unit_code, u.designation, u.designation_custom,
            p.code AS property_code, p.address
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN renters r ON r.id = l.renter_id
     LEFT JOIN (
       SELECT lease_id, SUM(amount) AS paid FROM rent_payments
       WHERE covers_period_start BETWEEN :firstDay AND :lastDay AND deleted_at IS NULL GROUP BY lease_id
     ) pay ON pay.lease_id = l.id
     WHERE l.tenant_id = :tenantId AND l.start_date <= :lastDay
       AND (l.status = 'active' OR (l.end_date IS NOT NULL AND l.end_date >= :firstDay)) ${scopeClause}`,
    params,
  );
  return listRentMonthDetails(
    leases.map((l) => ({
      startDate: l.start_date,
      endDate: l.end_date,
      createdAt: l.created_at,
      upToDateAtOnboarding: !!l.up_to_date_at_onboarding,
      rentDueDay: l.rent_due_day,
      rentDueOffsetDays: l.rent_due_offset_days,
      rentTiming: l.rent_timing,
      monthlyRent: Number(l.monthly_rent),
      entryProration: l.entry_proration,
      paid: Number(l.paid),
      id: l.id,
      renterId: l.renter_id,
      renterName: `${l.first_name} ${l.last_name}`,
      unitLabel: `${l.designation === 'autre' ? l.designation_custom : DESIGNATION_LABELS[l.designation] ?? l.designation} (${l.unit_code})`,
      propertyLabel: l.address ? `${l.property_code} · ${l.address}` : l.property_code,
    })),
    month,
  );
}

module.exports = {
  computeArrears,
  buildRentStrip,
  summarizeRentMonth,
  computeRentMonthSummary,
  listRentMonthDetails,
  listRentMonthRenters,
  rentMonthState,
  addMonth,
  addPeriod,
  periodEndOf,
  paymentPeriodKey,
  nextPeriodKey,
  previousPeriodKey,
  periodKeyContainingToday,
  periodKeyStartingInMonth,
  resolveRentDueDate,
  allocateRentPayment,
  monthsBetweenInclusive,
  periodsBetweenInclusive,
  isPaymentLate,
  recentMonthlyLateCount,
  listPortfolioArrears,
  computeRentOwed,
  listPredictiveLateAlerts,
  snapshotLeaseBalances,
  firstRegularDueDate,
  computeEntryProrata,
  baselineMonthOf,
};
