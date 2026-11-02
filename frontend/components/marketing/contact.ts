/**
 * Contact public de Africa Immo Management — renseigné par variable d'environnement, jamais codé en dur :
 * tant que `NEXT_PUBLIC_CONTACT_WHATSAPP` (chiffres seuls, indicatif compris, ex. 229XXXXXXXX) et
 * `NEXT_PUBLIC_CONTACT_EMAIL` sont vides, aucun bouton de contact n'apparaît (pas de faux numéro).
 *
 * `phone` fait exception : demandé explicitement par l'utilisateur (2026-11-02), affiché par défaut —
 * `NEXT_PUBLIC_CONTACT_PHONE` permet de le remplacer sans toucher au code si le numéro change.
 */
const digits = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "").replace(/\D/g, "");
const email = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "").trim();
const phone = (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "+229 01 52 93 37 15").trim();

export const CONTACT = {
  whatsappUrl: digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent("Bonjour, je voudrais en savoir plus sur Africa Immo Management.")}`
    : null,
  email: email || null,
  phone,
  /** Pour un lien `tel:` — chiffres et « + » uniquement. */
  phoneTel: phone.replace(/[^\d+]/g, ""),
};
