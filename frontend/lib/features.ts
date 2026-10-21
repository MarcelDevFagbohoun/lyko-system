// Assistant IA reporté à une version ultérieure : mettre NEXT_PUBLIC_ASSISTANT_ENABLED=true pour le réactiver
// (le backend doit aussi avoir ASSISTANT_FEATURE_ENABLED=true).
export const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "true";
