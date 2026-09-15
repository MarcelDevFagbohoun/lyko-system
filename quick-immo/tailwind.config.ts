import type { Config } from "tailwindcss";

/**
 * Charte graphique Lyko System — dérivée de la maquette
 * (stitch "Cabinet M Conseils Design System", section DESIGN.md).
 *
 * Règle : toutes les couleurs sont exposées comme tokens sémantiques.
 * Aucun écran ne doit utiliser une couleur hors de cette palette.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Fonds & surfaces ────────────────────────────────
        canvas: "#F8FAFC", // fond de page (slate-50)
        surface: {
          DEFAULT: "#FFFFFF", // cartes, panneaux
          muted: "#F1F5F9", // zones creuses, en-têtes de tableau
          hover: "#F8FAFC", // survol de ligne
        },
        border: {
          DEFAULT: "#E2E8F0", // hairline
          strong: "#CBD5E1", // séparateurs marqués / focus
        },

        // ── Texte ───────────────────────────────────────────
        ink: {
          DEFAULT: "#0F172A", // titres & texte principal (slate-900)
          soft: "#334155", // corps secondaire (slate-700)
          muted: "#64748B", // métadonnées, placeholders (slate-500)
          faint: "#94A3B8", // placeholders désactivés
        },

        // ── Marque / primaire ───────────────────────────────
        primary: {
          DEFAULT: "#1E3A8A", // bleu marine — actions principales
          hover: "#1E40AF", // cobalt — hover/active
          fg: "#FFFFFF",
          bg: "#E8ECF9", // teinte claire — boutons d'action secondaires (gras + colorés, jamais plats)
          border: "#B7C3EA",
        },

        // ── Statuts (cohérents sur toute la plateforme) ─────
        success: {
          DEFAULT: "#059669", // à jour / résolu / payé
          fg: "#047857",
          bg: "#ECFDF5",
          border: "#A7F3D0",
          strong: "#046C4E", // aplat plein sur texte blanc (tuiles de tableau de bord)
        },
        warning: {
          DEFAULT: "#D97706", // en cours / en attente
          fg: "#B45309",
          bg: "#FFFBEB",
          border: "#FDE68A",
          strong: "#A24E07", // aplat plein sur texte blanc
        },
        danger: {
          DEFAULT: "#DC2626", // en retard / impayé / urgent
          hover: "#B91C1C",
          fg: "#DC2626",
          bg: "#FEF2F2",
          border: "#FECACA",
          strong: "#B01818", // aplat plein sur texte blanc
        },
        info: {
          DEFAULT: "#2563EB", // procédure / information
          fg: "#1D4ED8",
          bg: "#EFF6FF",
          border: "#BFDBFE",
        },

        // Canal WhatsApp (relances) — usage strictement limité aux CTA WhatsApp.
        whatsapp: { DEFAULT: "#25D366", dark: "#075E54" },
      },

      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-geist)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "headline-2xl": ["36px", { lineHeight: "44px", letterSpacing: "-0.025em", fontWeight: "700" }],
        "headline-xl": ["30px", { lineHeight: "38px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "headline-lg": ["24px", { lineHeight: "32px", letterSpacing: "-0.015em", fontWeight: "600" }],
        "headline-md": ["20px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-sm": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "body-sm": ["13px", { lineHeight: "18px" }],
        "body-xs": ["12px", { lineHeight: "16px" }],
        "label-md": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "currency-display": ["22px", { lineHeight: "28px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "currency-table": ["13px", { lineHeight: "18px", fontWeight: "600" }],
      },
      borderRadius: {
        sm: "0.125rem",
        DEFAULT: "0.375rem", // inputs, boutons
        md: "0.375rem",
        lg: "0.5rem", // cartes, panneaux
        xl: "0.75rem",
      },
      spacing: {
        "sidebar": "16.25rem", // 260px
        "sidebar-collapsed": "4.5rem", // 72px
        "topbar": "3.5rem", // 56px
        "content-max": "88rem", // 1408px
      },
      boxShadow: {
        // Élévations sobres de la charte (ombres ambiantes légères).
        sm: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
        md: "0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)",
        lg: "0 20px 25px -5px rgb(15 23 42 / 0.1), 0 8px 10px -6px rgb(15 23 42 / 0.06)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
