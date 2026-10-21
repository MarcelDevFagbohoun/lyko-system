import * as React from "react";
import { cn } from "@/lib/utils";

export const BRAND_NAME = "Africa Immo Management";

/**
 * Logo « Africa Immo Management » : pastille dégradée bleue (toit blanc, trois piliers, point de liaison) +
 * nom et signature « Gestion & Technologies ». Utilisé tant que le DG n'a pas importé le logo de son entreprise
 * (section 4.3 du cahier des charges).
 */
export function BrandLogo({
  className,
  withWordmark = true,
  title = BRAND_NAME,
}: {
  className?: string;
  withWordmark?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox={withWordmark ? "0 0 440 80" : "0 0 80 80"}
      className={cn("h-8 w-auto", className)}
      fill="none"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="aimGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0A84CB" />
          <stop offset="50%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#111B3F" />
        </linearGradient>
      </defs>

      <rect width="80" height="80" rx="18" fill="url(#aimGrad)" />
      {/* Contenu dessiné sur 288 × 288 puis ramené à 80 × 80 */}
      <g transform="scale(0.2778)">
        <path d="M85 146 L144 69 L203 146 H175 L144 112 L113 146 Z" fill="#FFFFFF" />
        <path d="M144 143 L103 169 M144 143 L185 169" stroke="#8EC5F8" strokeWidth="5" strokeLinecap="round" />
        <rect x="92" y="169" width="22" height="55" rx="11" fill="#FFFFFF" />
        <rect x="132" y="168" width="24" height="56" rx="12" fill="#1FA2E0" />
        <rect x="174" y="169" width="22" height="55" rx="11" fill="#FFFFFF" />
        <circle cx="144" cy="143" r="10" fill="#38BDF8" />
      </g>

      {withWordmark && (
        <>
          <text
            x="96"
            y="38"
            fontFamily="var(--font-geist), system-ui, sans-serif"
            fontWeight="800"
            fontSize="20"
            fill="#0F172A"
            letterSpacing="-0.01em"
          >
            AFRICA IMMO MANAGEMENT
          </text>
          <rect x="96" y="46" width="22" height="3.5" rx="1.75" fill="#2563EB" />
          <rect x="122" y="46" width="7" height="3.5" rx="1.75" fill="#38BDF8" />
          <text
            x="96"
            y="66"
            fontFamily="var(--font-inter), system-ui, sans-serif"
            fontWeight="700"
            fontSize="9.5"
            fill="#0284C7"
            letterSpacing="0.3em"
          >
            GESTION &amp; TECHNOLOGIES
          </text>
        </>
      )}
    </svg>
  );
}
