/** Mise en forme de la fiche de notes : actions de la barre d'outils appliquées à la sélection du champ de texte. */

export type FormatKind = "bold" | "italic" | "heading" | "bullet" | "numbered";
export type Edit = { text: string; start: number; end: number };

function wrap(value: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const selected = value.slice(start, end);
  // Déjà entouré : on retire la mise en forme (second clic = annuler).
  if (selected.length >= mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, selected.length - mark.length);
    return { text: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  const body = selected || placeholder;
  const text = value.slice(0, start) + mark + body + mark + value.slice(end);
  return { text, start: start + mark.length, end: start + mark.length + body.length };
}

/** Étend la sélection aux lignes entières qu'elle touche. */
function lineRange(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  return [from, nl === -1 ? value.length : nl];
}

const ANY_PREFIX = /^\s*(?:[-*•]|\d+[.)]|#{1,3})\s+/;

function prefixLines(value: string, start: number, end: number, prefixFor: (i: number) => string, isPrefixed: (line: string) => RegExp | null): Edit {
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const re = isPrefixed("");
  const allPrefixed = lines.every((l) => l.trim() === "" || (re && re.test(l)));
  const out = lines.map((l, i) => {
    if (l.trim() === "") return l;
    if (allPrefixed && re) return l.replace(re, "");
    return prefixFor(i) + l.replace(ANY_PREFIX, ""); // on remplace une autre puce, un autre titre ou une numérotation
  });
  const block = out.join("\n");
  return { text: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

export function applyFormat(value: string, start: number, end: number, kind: FormatKind): Edit {
  switch (kind) {
    case "bold":
      return wrap(value, start, end, "**", "texte important");
    case "italic":
      return wrap(value, start, end, "_", "texte");
    case "heading":
      return prefixLines(value, start, end, () => "## ", () => /^#{1,3}\s+/);
    case "bullet":
      return prefixLines(value, start, end, () => "- ", () => /^\s*[-*•]\s+/);
    case "numbered": {
      let n = 0;
      return prefixLines(value, start, end, () => `${++n}. `, () => /^\s*\d+[.)]\s+/);
    }
  }
}
