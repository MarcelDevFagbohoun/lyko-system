import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatFcfa(amount: number, opts?: { withSuffix?: boolean }): string {
  const withSuffix = opts?.withSuffix ?? true;
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  const grouped = n.toLocaleString("fr-FR").replace(/ |\s/g, " ");
  return withSuffix ? `${grouped} FCFA` : grouped;
}

// Numérotation béninoise : 10 chiffres locaux commençant par 0 (accepte
// aussi la saisie avec indicatif +229 / 229 / 00229) — même règle que le
// backend (`validators/auth.js`).
const PHONE_LOCAL_RE = /^0\d{9}$/;

export function normalizeBeninPhone(raw: string): string | null {
  let s = raw.replace(/[\s.-]/g, "");
  if (s.startsWith("+229")) s = s.slice(4);
  else if (s.startsWith("00229")) s = s.slice(5);
  else if (s.startsWith("229") && s.length === 12) s = s.slice(3);
  return PHONE_LOCAL_RE.test(s) ? s : null;
}

export function toE164Benin(localPhone: string): string {
  const normalized = normalizeBeninPhone(localPhone);
  if (!normalized) return localPhone;
  return `+229${normalized.slice(1)}`;
}

/** Lien wa.me pré-rempli vers un numéro local (0XXXXXXXXX). */
export function buildWhatsAppHref(localPhone: string, message: string): string {
  return `https://wa.me/${toE164Benin(localPhone).replace("+", "")}?text=${encodeURIComponent(message)}`;
}
