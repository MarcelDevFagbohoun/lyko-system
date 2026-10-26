// Sécurité du rendu des réponses de l'assistant : le texte d'un modèle est une donnée non fiable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeInternalHref, parseInline, parseMarkdown } from "../lib/safe-markdown.ts";

test("liens : seules les pages internes de l'espace sont acceptées", () => {
  for (const ok of ["/espace", "/espace/loyers", "/espace/baux/12", "/espace/loyers?mois=2026-09"]) {
    assert.equal(isSafeInternalHref(ok), true, ok);
  }
  for (const bad of [
    "https://evil.example/x",
    "//evil.example",
    "javascript:alert(1)",
    "/espace/../admin",
    "/espace//evil",
    "/autre",
    "/espace/a b",
    "data:text/html,<script>",
  ]) {
    assert.equal(isSafeInternalHref(bad), false, bad);
  }
});

test("un lien externe est réduit à son libellé, jamais cliquable", () => {
  const out = parseInline("voir [ici](https://evil.example/?s=1) puis [loyers](/espace/loyers)");
  assert.deepEqual(out, [
    { kind: "text", text: "voir " },
    { kind: "text", text: "ici" },
    { kind: "text", text: " puis " },
    { kind: "link", text: "loyers", href: "/espace/loyers" },
  ]);
});

test("une image Markdown ne produit jamais de lien ni d'image chargée", () => {
  const out = parseInline("![x](https://evil.example/p.png?secret=1)");
  assert.equal(out.some((i) => i.kind === "link"), false);
});

test("gras et code en ligne", () => {
  assert.deepEqual(parseInline("a **b** `c`"), [
    { kind: "text", text: "a " },
    { kind: "bold", text: "b" },
    { kind: "text", text: " " },
    { kind: "code", text: "c" },
  ]);
});

test("le HTML reste du texte brut", () => {
  assert.deepEqual(parseInline("<script>alert(1)</script>"), [{ kind: "text", text: "<script>alert(1)</script>" }]);
});

test("blocs : paragraphes, listes à puces et numérotées", () => {
  const blocks = parseMarkdown("Bonjour\nle monde\n\n- un\n- deux\n\n1. a\n2. b");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].kind, "paragraph");
  assert.deepEqual(blocks[1], {
    kind: "list",
    ordered: false,
    items: [[{ kind: "text", text: "un" }], [{ kind: "text", text: "deux" }]],
  });
  assert.equal(blocks[2].kind === "list" && blocks[2].ordered, true);
});
