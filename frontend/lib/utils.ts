import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Fusionne des classes Tailwind conditionnelles sans conflit. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convertit une valeur de sélecteur de date (« AAAA-MM-JJ », ex. depuis un
 * `<input type="date">`) en libellé français lisible, ex. « 6 juin 2026 ».
 * Le jour est essentiel — jamais réduit au mois seul — et la date reste
 * choisie dans un calendrier, jamais saisie à la main : ce libellé n'est
 * qu'un affichage dérivé de cette sélection.
 */
/**
 * Message de relance loyer en retard — même formulation partout dans
 * l'application (fiche locataire, centre de relance groupée de l'étape 10),
 * pour construire un lien WhatsApp pré-rempli (`buildWhatsAppHref`).
 */
export function buildRentReminderMessage(params: {
  renterFirstName: string;
  unitLabel: string;
  monthlyRent: number;
  daysLate: number;
  dueDate: string;
  companyName?: string | null;
}): string {
  return [
    `Bonjour ${params.renterFirstName},`,
    `Nous vous rappelons que le loyer de ${params.unitLabel} (${formatFcfa(params.monthlyRent)})`,
    `est en retard de ${params.daysLate} jour(s) (échéance du ${params.dueDate}).`,
    `Merci de régulariser votre situation rapidement.`,
    params.companyName ? `Cordialement, ${params.companyName}` : "",
  ].join(" ");
}

/**
 * Message de relance PRÉDICTIVE (étape 13, idée n°4) — avant l'échéance, pas
 * après : ton différent du rappel de retard ci-dessus (une échéance à venir,
 * jamais « en retard »).
 */
export function buildPredictiveReminderMessage(params: {
  renterFirstName: string;
  unitLabel: string;
  monthlyRent: number;
  dueDate: string;
  companyName?: string | null;
}): string {
  return [
    `Bonjour ${params.renterFirstName},`,
    `Nous vous rappelons que le loyer de ${params.unitLabel} (${formatFcfa(params.monthlyRent)})`,
    `arrive à échéance le ${params.dueDate}.`,
    `Merci de bien vouloir procéder au règlement à temps.`,
    params.companyName ? `Cordialement, ${params.companyName}` : "",
  ].join(" ");
}

/**
 * Message de relance pour une facture SONEB/SBEE impayée ou partiellement
 * payée (étape 28) — même ton que le rappel de loyer, mais « facturée le »
 * plutôt qu'une échéance (une facture ponctuelle n'a pas de jour d'échéance
 * fixe, contrairement au loyer).
 */
export function buildUtilityReminderMessage(params: {
  renterFirstName: string;
  unitLabel: string;
  utilityTypeLabel: string;
  amountOwed: number;
  daysLate: number;
  billedAt: string;
  companyName?: string | null;
}): string {
  return [
    `Bonjour ${params.renterFirstName},`,
    `Nous vous rappelons que votre facture ${params.utilityTypeLabel} de ${params.unitLabel} (${formatFcfa(params.amountOwed)})`,
    `est en attente de règlement depuis ${params.daysLate} jour(s) (facturée le ${params.billedAt}).`,
    `Merci de régulariser votre situation rapidement.`,
    params.companyName ? `Cordialement, ${params.companyName}` : "",
  ].join(" ");
}

/**
 * Message d'envoi de quittance par WhatsApp — un lien `wa.me` ne peut
 * préremplir qu'un texte, jamais joindre un fichier : le message contient
 * donc un lien direct vers le PDF (voir `generateReceiptShareLink`/
 * `receiptShareUrl`, `lib/api/renters.ts`), pas la quittance elle-même.
 */
export function buildReceiptMessage(params: {
  renterFirstName: string;
  coversMonth: string;
  amount: number;
  url: string;
  companyName?: string | null;
}): string {
  return [
    `Bonjour ${params.renterFirstName},`,
    `Nous confirmons la réception de votre paiement de ${formatFcfa(params.amount)} pour ${monthLabelFr(params.coversMonth)}.`,
    `Votre quittance : ${params.url}`,
    `Merci !`,
    params.companyName ? `Cordialement, ${params.companyName}` : "",
  ].join(" ");
}

/** Mois suivant, format « AAAA-MM ». */
export function addMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // `m` (et non m-1) avance déjà d'un mois
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « 2026-09 » → « septembre 2026 ». */
export function monthLabelFr(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return yearMonth;
  return `${MONTHS_FR[m - 1]} ${y}`;
}

/**
 * Répartition d'un montant sur des mois de loyer consécutifs à partir de
 * `startMonth` — miroir exact de `allocateRentPayment` côté serveur
 * (`backend/src/services/rentTracking.js`). Sert uniquement à l'aperçu affiché
 * dans le formulaire ; le serveur reste la source de vérité.
 */
export function previewRentAllocation(startMonth: string, monthlyRent: number, amount: number) {
  const rent = Math.max(0, Math.round(monthlyRent));
  const total = Math.max(0, Math.round(amount));
  const fullMonths = rent > 0 ? Math.floor(total / rent) : 0;
  const partialAmount = rent > 0 ? total % rent : total;
  const items: { coversMonth: string; amount: number; isPartial: boolean }[] = [];
  let month = startMonth;
  for (let i = 0; i < fullMonths; i += 1) {
    items.push({ coversMonth: month, amount: rent, isPartial: false });
    month = addMonth(month);
  }
  if (partialAmount > 0) items.push({ coversMonth: month, amount: partialAmount, isPartial: true });
  return { fullMonths, partialAmount, monthsCovered: items.length, items };
}

export function formatDateLabel(isoDate: string): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  if (!y || !m || !day) return isoDate;
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Comme `formatDateLabel`, avec le jour de la semaine — ex. « Mardi 23/01/2026 ». */
export function formatDateHeading(isoDate: string): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  if (!y || !m || !day) return isoDate;
  const d = new Date(Date.UTC(y, m - 1, day));
  const weekday = d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${date}`;
}

/**
 * Heure d'un horodatage serveur (`created_at`) au format « HH:MM ». Le pool
 * MySQL étiquette les horodatages en UTC alors qu'ils sont en heure locale
 * (`timezone: 'Z'`) : on relit donc les chiffres en forçant `timeZone: "UTC"`
 * plutôt que de laisser le navigateur les reconvertir, sous peine d'un
 * décalage d'une heure à l'affichage.
 */
export function formatTimeOfDay(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

/**
 * Formate un montant en francs CFA selon la charte :
 * séparateur de milliers par espace insécable, suffixe « FCFA ».
 *   formatFcfa(1250000) → "1 250 000 FCFA"
 */
export function formatFcfa(amount: number, opts?: { withSuffix?: boolean }): string {
  const withSuffix = opts?.withSuffix ?? true;
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  const grouped = n.toLocaleString("fr-FR").replace(/ |\s/g, " ");
  return withSuffix ? `${grouped} FCFA` : grouped;
}

/**
 * Retard exprimé en mois + jours plutôt qu'en jours bruts (demande directe
 * de l'utilisateur : au-delà d'un mois, "103 j" se lit mal — "3 mois et
 * 13 j" est plus clair). Sous un mois, reste en jours seuls.
 */
export function formatLateDuration(monthsLate: number, remainderDaysLate: number, daysLate: number): string {
  if (monthsLate <= 0) return `${daysLate} j`;
  const monthLabel = monthsLate === 1 ? "1 mois" : `${monthsLate} mois`;
  return remainderDaysLate > 0 ? `${monthLabel} et ${remainderDaysLate} j` : monthLabel;
}

/**
 * Texte + urgence d'une tâche à délai (demande directe de l'utilisateur) :
 * « à faire aujourd'hui », « reste N jour(s) », ou en retard passé la date
 * limite si elle n'est pas encore marquée terminée.
 */
export function formatTaskDueLabel(
  dueDate: string,
  completedAt: string | null,
): { text: string; urgency: "done" | "overdue" | "today" | "soon" | "later" } {
  if (completedAt) return { text: "Terminée", urgency: "done" };

  const [y, m, d] = dueDate.split("-").map(Number);
  const due = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntil = Math.round((due - today) / 86_400_000);

  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return { text: `En retard de ${n} jour${n > 1 ? "s" : ""}`, urgency: "overdue" };
  }
  if (daysUntil === 0) return { text: "À faire aujourd'hui", urgency: "today" };
  return { text: `Reste ${daysUntil} jour${daysUntil > 1 ? "s" : ""}`, urgency: daysUntil <= 2 ? "soon" : "later" };
}
