// Tests des calculs et formats critiques du frontend (aperçus de loyer, dates, montants).
// Exécution : `npm test` (Node ≥ 22.18, TypeScript natif — aucune dépendance ajoutée).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonth,
  monthLabelFr,
  previewEntryProrata,
  previewRentAllocation,
  formatFcfa,
  formatDateLabel,
  formatDateHeading,
  formatTimeOfDay,
  formatLateDuration,
  formatTaskDueLabel,
} from "../lib/utils.ts";

test("addMonth : clé calendaire, passage d'année", () => {
  assert.equal(addMonth("2026-09"), "2026-10");
  assert.equal(addMonth("2026-12"), "2027-01");
});

test("addMonth : clé jour fixe, ancrée sur le même jour", () => {
  assert.equal(addMonth("2026-10-05"), "2026-11-05");
  assert.equal(addMonth("2026-12-15"), "2027-01-15");
});

test("monthLabelFr : mois calendaire et plage non calendaire", () => {
  assert.equal(monthLabelFr("2026-09"), "septembre 2026");
  assert.equal(monthLabelFr("2026-10-05"), "05/10 – 04/11/2026");
  assert.equal(monthLabelFr("2026-12-05"), "05/12/2026 – 04/01/2027");
  assert.equal(monthLabelFr("2026-13"), "2026-13");
});

test("previewEntryProrata : diviseur forfaitaire de 30 jours", () => {
  // Entrée le 10, échéance le 15 du même mois : 5 jours.
  assert.deepEqual(previewEntryProrata({ startDate: "2026-09-10", monthlyRent: 30000, rentDueDay: 15 }), {
    days: 5,
    amount: 5000,
    dueDate: "2026-09-15",
  });
  // Entrée le 20, échéance le 15 : échéance du mois suivant.
  const next = previewEntryProrata({ startDate: "2026-09-20", monthlyRent: 30000, rentDueDay: 15 });
  assert.equal(next.dueDate, "2026-10-15");
  assert.equal(next.days, 25);
  assert.equal(next.amount, 25000);
});

test("previewEntryProrata : entrées invalides → zéro, jamais d'exception", () => {
  assert.equal(previewEntryProrata({ startDate: "", monthlyRent: 1000, rentDueDay: 5 }).amount, 0);
  assert.equal(previewEntryProrata({ startDate: "2026-09-10", monthlyRent: 1000, rentDueDay: 31 }).amount, 0);
  assert.equal(previewEntryProrata({ startDate: "2026-09-10", monthlyRent: 0, rentDueDay: 15 }).amount, 0);
});

test("previewRentAllocation : mois entiers + reliquat partiel", () => {
  const r = previewRentAllocation("2026-09", 50000, 130000);
  assert.equal(r.fullMonths, 2);
  assert.equal(r.partialAmount, 30000);
  assert.equal(r.monthsCovered, 3);
  assert.deepEqual(
    r.items.map((i) => [i.coversMonth, i.amount, i.isPartial]),
    [
      ["2026-09", 50000, false],
      ["2026-10", 50000, false],
      ["2026-11", 30000, true],
    ],
  );
});

test("previewRentAllocation : un mois déjà entamé se complète d'abord", () => {
  const r = previewRentAllocation("2026-09", 50000, 70000, 20000);
  assert.deepEqual(
    r.items.map((i) => [i.coversMonth, i.amount, i.isPartial, i.completes]),
    [
      ["2026-09", 30000, false, true],
      ["2026-10", 40000, true, false],
    ],
  );
});

test("previewRentAllocation : montant inférieur au reste du mois → un seul versement partiel", () => {
  const r = previewRentAllocation("2026-09", 50000, 10000, 20000);
  assert.equal(r.monthsCovered, 1);
  assert.equal(r.items[0].isPartial, true);
  assert.equal(r.items[0].amount, 10000);
});

test("previewRentAllocation : loyer nul ou montant nul", () => {
  assert.equal(previewRentAllocation("2026-09", 50000, 0).monthsCovered, 0);
  assert.equal(previewRentAllocation("2026-09", 0, 0).monthsCovered, 0);
});

test("formatFcfa : séparateur de milliers insécable fin, arrondi, valeurs invalides", () => {
  const norm = (s: string) => s.replace(/\s/g, " ");
  assert.equal(norm(formatFcfa(1250000)), "1 250 000 FCFA");
  assert.equal(norm(formatFcfa(1250000, { withSuffix: false })), "1 250 000");
  assert.equal(norm(formatFcfa(999.6)), "1 000 FCFA");
  assert.equal(norm(formatFcfa(Number.NaN)), "0 FCFA");
});

test("formatDateLabel / formatDateHeading : indépendants du fuseau de la machine", () => {
  assert.equal(formatDateLabel("2026-01-23"), "23 janvier 2026");
  assert.equal(formatDateHeading("2026-01-23"), "Vendredi 23/01/2026");
  assert.equal(formatDateLabel("n'importe quoi"), "n'importe quoi");
});

test("formatTimeOfDay : relit les chiffres en UTC", () => {
  assert.equal(formatTimeOfDay("2026-10-26T14:05:00.000Z"), "14:05");
  assert.equal(formatTimeOfDay("pas une date"), "");
});

test("formatLateDuration : jours sous un mois, mois + jours au-delà", () => {
  assert.equal(formatLateDuration(0, 12, 12), "12 j");
  assert.equal(formatLateDuration(1, 0, 30), "1 mois");
  assert.equal(formatLateDuration(3, 13, 103), "3 mois et 13 j");
});

test("formatTaskDueLabel : terminée, aujourd'hui, retard, bientôt, plus tard", () => {
  const day = (offset: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset)).toISOString().slice(0, 10);
  };
  assert.equal(formatTaskDueLabel(day(-5), "2026-01-01").urgency, "done");
  assert.deepEqual(formatTaskDueLabel(day(0), null), { text: "À faire aujourd'hui", urgency: "today" });
  assert.deepEqual(formatTaskDueLabel(day(-1), null), { text: "En retard de 1 jour", urgency: "overdue" });
  assert.deepEqual(formatTaskDueLabel(day(-3), null), { text: "En retard de 3 jours", urgency: "overdue" });
  assert.deepEqual(formatTaskDueLabel(day(2), null), { text: "Reste 2 jours", urgency: "soon" });
  assert.deepEqual(formatTaskDueLabel(day(9), null), { text: "Reste 9 jours", urgency: "later" });
});
