/**
 * Regroupement par mois pour les listes financières (paiements, versements,
 * charges) : « où en est chaque mois » se lit d'un coup d'œil, au lieu d'une
 * longue liste plate triée par date.
 */
export type MonthGroup<T> = {
  /** « AAAA-MM », ou « » quand la date est absente/illisible (rangé en dernier). */
  month: string;
  items: T[];
};

/**
 * Regroupe `items` par mois, du plus récent au plus ancien. L'ordre des
 * éléments à l'intérieur d'un mois est celui reçu (le serveur trie déjà).
 * `getMonth` peut renvoyer une date complète (« 2026-09-14 ») : seuls les
 * 7 premiers caractères comptent.
 */
export function groupByMonth<T>(
  items: readonly T[],
  getMonth: (item: T) => string | null | undefined,
): MonthGroup<T>[] {
  const byMonth = new Map<string, T[]>();
  for (const item of items) {
    const raw = getMonth(item);
    const month = raw && /^\d{4}-(0[1-9]|1[0-2])/.test(raw) ? raw.slice(0, 7) : "";
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, groupItems]) => ({ month, items: groupItems }));
}

/** Somme d'un champ numérique sur un groupe. */
export function sumBy<T>(items: readonly T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}
