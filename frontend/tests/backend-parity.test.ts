// Les aperçus du formulaire (frontend) doivent rester identiques aux calculs réels du serveur
// (backend/src/services/rentTracking.js). Ces tests comparent les deux sur de nombreux cas ;
// ils sont ignorés si le dossier backend n'est pas présent (déploiement du frontend seul).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { previewEntryProrata, previewRentAllocation } from "../lib/utils.ts";

const backendPath = fileURLToPath(new URL("../../backend/src/services/rentTracking.js", import.meta.url));
const skip = !existsSync(backendPath);
// Le module serveur crée un pool MySQL à l'import (sans jamais se connecter ici) et refuse toute base
// qui n'est pas une base de test : on le pointe donc explicitement sur la base *_test.
if (!skip) process.env.DB_NAME = "lyko_system_test";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const backend: any = skip ? null : createRequire(import.meta.url)(backendPath);

test("prorata d'entrée : aperçu = serveur", { skip }, () => {
  const rents = [0, 25000, 45000, 150000, 333333];
  for (const startDate of ["2026-01-01", "2026-01-31", "2026-02-27", "2026-02-28", "2026-09-10", "2026-12-20", "2027-03-15"]) {
    for (const rentDueDay of [1, 5, 10, 15, 28]) {
      for (const monthlyRent of rents) {
        const front = previewEntryProrata({ startDate, monthlyRent, rentDueDay });
        const server = backend.computeEntryProrata({ startDate, monthlyRent, rentDueDay });
        assert.deepEqual(front, server, `${startDate} jour ${rentDueDay} loyer ${monthlyRent}`);
      }
    }
  }
});

test("répartition d'un paiement : aperçu = serveur (rythme calendaire)", { skip }, () => {
  const rent = 50000;
  for (const amount of [1, 20000, 49999, 50000, 50001, 100000, 130000, 275000]) {
    for (const alreadyPaid of [0, 10000, 49999]) {
      const front = previewRentAllocation("2026-09", rent, amount, alreadyPaid);
      const { allocations } = backend.allocateRentPayment({
        rhythm: { mode: "calendaire" },
        nextDueMonth: "2026-09",
        monthlyRent: rent,
        alreadyPaidForNextDueMonth: alreadyPaid,
        amount,
      });
      assert.deepEqual(
        front.items.map((i) => [i.coversMonth, i.amount, i.isPartial]),
        allocations.map((a: { coversMonth: string; amount: number; isPartial: boolean }) => [a.coversMonth, a.amount, a.isPartial]),
        `montant ${amount}, déjà payé ${alreadyPaid}`,
      );
    }
  }
});
