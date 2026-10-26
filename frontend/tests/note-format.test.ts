import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFormat } from "../lib/note-format.ts";

test("gras et italique : entoure la sélection, un second clic l'annule", () => {
  const v = "Paie en retard";
  const b = applyFormat(v, 8, 14, "bold");
  assert.equal(b.text, "Paie en **retard**");
  assert.equal(b.text.slice(b.start, b.end), "retard");
  const undo = applyFormat(b.text, b.start - 2, b.end + 2, "bold");
  assert.equal(undo.text, v);
  assert.equal(applyFormat("", 0, 0, "italic").text, "_texte_"); // sans sélection : texte d'exemple
  assert.equal(applyFormat("un mot", 3, 6, "italic").text, "un _mot_");
});

test("titre : préfixe la ligne touchée, un second clic le retire", () => {
  const v = "Paiement\nRégulier";
  const h = applyFormat(v, 2, 2, "heading");
  assert.equal(h.text, "## Paiement\nRégulier");
  assert.equal(applyFormat(h.text, 2, 2, "heading").text, v);
});

test("listes : toutes les lignes sélectionnées, lignes vides ignorées, numérotation continue", () => {
  const v = "a\nb\n\nc";
  const l = applyFormat(v, 0, v.length, "bullet");
  assert.equal(l.text, "- a\n- b\n\n- c");
  assert.equal(applyFormat(l.text, 0, l.text.length, "bullet").text, v); // retirer
  const n = applyFormat("x\ny", 0, 3, "numbered");
  assert.equal(n.text, "1. x\n2. y");
  // passer d'une puce à une numérotation remplace la puce
  assert.equal(applyFormat("- x", 0, 3, "numbered").text, "1. x");
  // la sélection ne s'étend qu'aux lignes touchées
  assert.equal(applyFormat("a\nb\nc", 2, 3, "bullet").text, "a\n- b\nc");
});
