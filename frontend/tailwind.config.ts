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
        canvas: "#F3F6FB", // fond de page — bleu-gris très doux : les cartes teintées ressortent dessus
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
          // Accessibilité (demande utilisateur, 2026-10-17 : « les couleurs doivent être pures et
          // lisibles », pour une personne malvoyante) — `muted` était slate-500 (#64748B, ~4,76:1 sur
          // blanc, à peine au-dessus du minimum AA 4,5:1) : trop fragile pour des libellés déjà petits
          // (12px) et en MAJUSCULES espacées (`StatCard`, en-têtes de section...), qui réduisent encore
          // la lisibilité perçue malgré un ratio nominal suffisant. Passé à slate-600 (~7,6:1, niveau
          // AAA). `faint` reprend l'ancienne valeur de `muted` (~4,76:1, AA) au lieu de slate-400
          // (~2,56:1, sous le minimum même pour du grand texte) : plusieurs usages réels (dates, lecture
          // de compteur précédente, en-têtes de menu) ne sont pas de simples placeholders désactivés
          // (seuls ceux-là sont exemptés du contraste minimal) et doivent rester lisibles.
          muted: "#475569", // métadonnées, libellés (slate-600)
          faint: "#64748B", // placeholders désactivés, texte très secondaire (slate-500)
        },

        // ── Marque / primaire ───────────────────────────────
        primary: {
          DEFAULT: "#1E3A8A", // bleu marine — actions principales
          hover: "#1E40AF", // cobalt — hover/active
          fg: "#FFFFFF",
          bg: "#E8ECF9", // teinte claire — boutons d'action secondaires (gras + colorés, jamais plats)
          border: "#B7C3EA",
        },

        // ── Teintes des « cadres » (module de l'espace : voir lib/module-theme.ts) ──
        // Une couleur = un cadre, jamais réutilisée pour un autre : bleu = vue d'ensemble,
        // violet = patrimoine, orange = opérations, cyan = finances, ardoise = administration.
        // Volontairement à l'écart des couleurs de STATUT ci-dessous (vert = payé, rouge = retard…),
        // qui gardent leur sens. bg + border = fond/liseré des cartes ; solid = pastille, icône, filet.
        tint: {
          blue: { bg: "#E9F0FF", border: "#C9D9FB", solid: "#2F5BD8" },
          violet: { bg: "#F0EBFF", border: "#D9CEFA", solid: "#7048E8" },
          orange: { bg: "#FFEEE0", border: "#FAD4B4", solid: "#E8590C" },
          cyan: { bg: "#E0F4F9", border: "#B9E3EE", solid: "#0E8AA8" },
          slate: { bg: "#ECF0F6", border: "#D5DCE7", solid: "#64748B" },
          // Teintes libres (usage ponctuel via `tone=`), sans cadre attitré.
          teal: { bg: "#E4F6F1", border: "#BFE6DA", solid: "#0F9D82" },
          amber: { bg: "#FEF3DE", border: "#F4DDAE", solid: "#C98A0B" },
          rose: { bg: "#FDEAEE", border: "#F5CBD5", solid: "#D6336C" },
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
      backgroundImage: {
        // Dégradé de marque (repris du logo) — réservé aux petites touches
        // décoratives (indicateur actif, liseré) : jamais un grand aplat
        // derrière un logo d'entreprise arbitraire (contraste imprévisible).
        "brand-gradient": "linear-gradient(135deg, #1E3A8A 0%, #2563EB 55%, #38BDF8 100%)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "sidebar-in": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "page-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Étape 55 — animations propres à chaque partie (voir `app/globals.css`, classes `.stagger`,
        // et la charte graphique) : toujours courtes, jamais bloquantes, coupées si l'utilisateur a
        // demandé moins d'animations (`prefers-reduced-motion`).
        "card-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "cell-pop": {
          "0%": { opacity: "0", transform: "scale(0.4)" },
          "70%": { opacity: "1", transform: "scale(1.12)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "gauge-fill": {
          from: { transform: "scaleY(0)" },
          to: { transform: "scaleY(1)" },
        },
        "bar-grow": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "lock-snap": {
          "0%": { transform: "translateY(-3px) rotate(-8deg)", opacity: "0.4" },
          "60%": { transform: "translateY(1px) rotate(3deg)", opacity: "1" },
          "100%": { transform: "translateY(0) rotate(0)", opacity: "1" },
        },
        sheen: {
          from: { transform: "translateX(-120%) skewX(-18deg)" },
          to: { transform: "translateX(320%) skewX(-18deg)" },
        },
        ripple: {
          "0%": { transform: "scale(0.8)", opacity: "0.55" },
          "100%": { transform: "scale(2.1)", opacity: "0" },
        },
        "urgent-ping": {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "80%, 100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "toast-progress": {
          from: { transform: "scaleX(1)" },
          to: { transform: "scaleX(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        "fade-in": "fade-in 0.18s ease-out",
        "sidebar-in": "sidebar-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "page-in": "page-in 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        "card-in": "card-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both",
        "cell-pop": "cell-pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "gauge-fill": "gauge-fill 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        "bar-grow": "bar-grow 0.9s cubic-bezier(0.16, 1, 0.3, 1) both",
        "lock-snap": "lock-snap 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        sheen: "sheen 1.1s cubic-bezier(0.4, 0, 0.2, 1) 0.35s both",
        ripple: "ripple 1.8s cubic-bezier(0, 0, 0.2, 1) infinite",
        "urgent-ping": "urgent-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite",
        "slide-in-left": "slide-in-left 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
