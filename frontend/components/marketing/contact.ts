/**
 * Contact public de Lyko System — renseigné par variable d'environnement, jamais codé en dur :
 * tant que `NEXT_PUBLIC_CONTACT_WHATSAPP` (chiffres seuls, indicatif compris, ex. 229XXXXXXXX) et
 * `NEXT_PUBLIC_CONTACT_EMAIL` sont vides, aucun bouton de contact n'apparaît (pas de faux numéro).
 */
const digits = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "").replace(/\D/g, "");
const email = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "").trim();

export const CONTACT = {
  whatsappUrl: digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent("Bonjour, je voudrais en savoir plus sur Lyko System.")}`
    : null,
  email: email || null,
};
