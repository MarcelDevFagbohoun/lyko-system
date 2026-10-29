const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 2026-10 » → « oct. 26 » (calcul pur sur la chaîne : aucun décalage de fuseau). */
export function monthLabel(k: string) {
  const [y, m] = k.split("-");
  return `${MONTHS_FR[Number(m) - 1]} ${y.slice(2)}`;
}

/** 1 250 000 → « 1,3M », 109 800 → « 110k » : étiquettes courtes au-dessus des barres. */
export function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "").replace(".", ",")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
