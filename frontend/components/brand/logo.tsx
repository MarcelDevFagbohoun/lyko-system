import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Logo par défaut « Lyko System » — repris de la maquette
 * (stitch logo_lyko_systeme). Utilisé tant que le DG n'a pas
 * importé le logo de son entreprise (section 4.3 du cahier des charges).
 */
export function LykoLogo({
  className,
  withWordmark = true,
  title = "Lyko System",
}: {
  className?: string;
  withWordmark?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox={withWordmark ? "0 0 320 80" : "0 0 80 80"}
      className={cn("h-8 w-auto", className)}
      fill="none"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="lykoGrad" x1="12" y1="12" x2="68" y2="68" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E3A8A" />
          <stop offset="50%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
        <linearGradient id="lykoAccent" x1="25" y1="20" x2="55" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#60A5FA" />
        </linearGradient>
      </defs>

      <rect x="12" y="12" width="56" height="56" rx="14" fill="url(#lykoGrad)" />
      <path
        d="M26 24V48C26 51.3137 28.6863 54 32 54H54"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="30" r="4.5" fill="#38BDF8" stroke="#FFFFFF" strokeWidth="2" />
      <path
        d="M48 34.5V44"
        stroke="url(#lykoAccent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 3"
      />
      <path
        d="M26 36L38 48"
        stroke="#93C5FD"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />

      {withWordmark && (
        <>
          <text
            x="82"
            y="42"
            fontFamily="var(--font-geist), system-ui, sans-serif"
            fontWeight="800"
            fontSize="24"
            fill="#0F172A"
            letterSpacing="-0.03em"
          >
            LYKO
          </text>
          <text
            x="146"
            y="42"
            fontFamily="var(--font-geist), system-ui, sans-serif"
            fontWeight="400"
            fontSize="24"
            fill="#2563EB"
            letterSpacing="-0.02em"
          >
            SYSTEM
          </text>
          <text
            x="83"
            y="58"
            fontFamily="var(--font-inter), system-ui, sans-serif"
            fontWeight="600"
            fontSize="9.5"
            fill="#64748B"
            letterSpacing="0.18em"
          >
            GESTION &amp; TECHNOLOGIES
          </text>
        </>
      )}
    </svg>
  );
}
