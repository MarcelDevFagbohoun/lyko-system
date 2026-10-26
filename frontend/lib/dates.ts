/**
 * Date du jour au format « AAAA-MM-JJ » en heure LOCALE de l'utilisateur.
 * Ne pas utiliser `new Date().toISOString().slice(0, 10)` : cette forme est en UTC et donne la veille
 * entre minuit et 1 h au Bénin (UTC+1), ce qui pré-remplissait des formulaires avec la mauvaise date.
 */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Dernier jour d'un mois « AAAA-MM » au format « AAAA-MM-JJ » (28 à 31 selon le mois, années bissextiles comprises).
 * À utiliser pour borner une plage « mois entier » : écrire « AAAA-MM-31 » est une date impossible pour avril, juin,
 * septembre, novembre et février, que MySQL 8 refuse.
 */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return `${month}-31`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}
