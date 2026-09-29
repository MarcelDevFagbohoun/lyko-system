/**
 * Mise en forme MINIMALE et sûre des réponses de l'assistant — volontairement pas une bibliothèque Markdown.
 *
 * Ce que le texte d'un modèle peut contenir est une donnée non fiable : une image `![](https://…?secret=…)`
 * ou un lien externe suffiraient à faire fuir des informations vers un tiers dès l'affichage. On ne sait donc
 * produire QUE : paragraphes, listes, gras, code en ligne, et liens vers une page interne de l'espace
 * (`/espace/...`). Tout le reste (images, liens externes, HTML, `javascript:`) reste du texte brut inoffensif
 * (React échappe tout) — jamais un élément cliquable ou chargé automatiquement.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

// Chemin interne de l'espace uniquement : pas de schéma, pas de `//`, pas d'espace, pas de `..`.
const INTERNAL_HREF = /^\/espace(?:\/[A-Za-z0-9_\-[\]]+)*(?:\?[A-Za-z0-9_=&\-.%]*)?$/;

export function isSafeInternalHref(href: string): boolean {
  return INTERNAL_HREF.test(href);
}

const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: "text", text: source.slice(last, index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (isSafeInternalHref(m[4])) out.push({ kind: "link", text: m[3], href: m[4] });
    else out.push({ kind: "text", text: m[3] }); // lien externe / dangereux : on ne garde que son libellé
    last = index + m[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const rawLine of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flushParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(item[1]));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}
