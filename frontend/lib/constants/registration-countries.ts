/**
 * Pays proposés au sélecteur de l'inscription (demande utilisateur, 2026-10-18) — miroir de
 * `backend/src/constants/countries.js`. Bénin + pays limitrophes/UEMOA, pas une liste mondiale.
 */
export type RegistrationCountryCode = "BJ" | "TG" | "NE" | "BF" | "CI" | "ML" | "SN" | "GW";

export const REGISTRATION_COUNTRIES: { code: RegistrationCountryCode; label: string; callingCode: string }[] = [
  { code: "BJ", label: "Bénin", callingCode: "229" },
  { code: "TG", label: "Togo", callingCode: "228" },
  { code: "NE", label: "Niger", callingCode: "227" },
  { code: "BF", label: "Burkina Faso", callingCode: "226" },
  { code: "CI", label: "Côte d'Ivoire", callingCode: "225" },
  { code: "ML", label: "Mali", callingCode: "223" },
  { code: "SN", label: "Sénégal", callingCode: "221" },
  { code: "GW", label: "Guinée-Bissau", callingCode: "245" },
];
