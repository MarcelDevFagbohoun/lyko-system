/**
 * Identité légale de la plateforme — renseignée par variables d'environnement (jamais codée en dur) :
 * une ligne vide n'est pas affichée. Version des conditions : à incrémenter à chaque modification du texte
 * (même valeur que TERMS_VERSION côté API).
 */
const v = (x: string | undefined) => (x ?? "").trim();

export const LEGAL = {
  name: v(process.env.NEXT_PUBLIC_LEGAL_NAME) || "Africa Immo Management",
  rccm: v(process.env.NEXT_PUBLIC_LEGAL_RCCM),
  ifu: v(process.env.NEXT_PUBLIC_LEGAL_IFU),
  address: v(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
  email: v(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  director: v(process.env.NEXT_PUBLIC_LEGAL_DIRECTOR),
  updatedOn: "21 octobre 2026",
};
