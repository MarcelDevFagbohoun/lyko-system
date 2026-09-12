/**
 * Miroir côté client des règles de validation du backend
 * (backend/src/validators/auth.js) — pour un retour immédiat à l'utilisateur.
 * Le backend reste la source de vérité ; ces règles n'ont qu'un rôle d'UX.
 */

const PHONE_LOCAL_RE = /^0\d{9}$/;

export function normalizeBeninPhone(raw: string): string | null {
  let s = raw.replace(/[\s.-]/g, "");
  if (s.startsWith("+229")) s = s.slice(4);
  else if (s.startsWith("00229")) s = s.slice(5);
  else if (s.startsWith("229") && s.length === 12) s = s.slice(3);
  return PHONE_LOCAL_RE.test(s) ? s : null;
}

/** Convertit un numéro local (0XXXXXXXXX) au format E.164 pour un lien wa.me. */
export function toE164Benin(localPhone: string): string {
  const normalized = normalizeBeninPhone(localPhone);
  if (!normalized) return localPhone;
  return `+229${normalized.slice(1)}`;
}

/** Lien wa.me pré-rempli vers un numéro local (0XXXXXXXXX) — relance loyer, invitation... */
export function buildWhatsAppHref(localPhone: string, message: string): string {
  return `https://wa.me/${toE164Benin(localPhone).replace("+", "")}?text=${encodeURIComponent(message)}`;
}

export const RCCM_RE = /^RB\/[A-Z]{2,4}\/\d{2}\s?[A-Z]\s?\d{3,7}$/;
export const IFU_RE = /^\d{13}$/;
export const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,72}$/;

export function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Très faible", "Faible", "Moyen", "Bon", "Fort", "Excellent"];
  return { score, label: labels[score] };
}
