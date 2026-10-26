/**
 * Date du jour au format « AAAA-MM-JJ » en heure LOCALE de l'utilisateur.
 * Ne pas utiliser `new Date().toISOString().slice(0, 10)` : cette forme est en UTC et donne la veille
 * entre minuit et 1 h au Bénin (UTC+1), ce qui pré-remplissait des formulaires avec la mauvaise date.
 */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
