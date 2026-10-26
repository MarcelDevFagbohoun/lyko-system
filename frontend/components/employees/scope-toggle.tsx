"use client";

import type { EmployeeRole } from "@/lib/api/employees";

/**
 * Remplace l'ancien « Profil d'accès » (Agent/Comptable). Le poste est un simple nom saisi par la direction ;
 * ce qui décide de ce que voit l'employé, ce sont ses permissions. Seule reste cette option : se limiter aux
 * biens qui lui sont assignés (techniquement le rôle « agent »), ou voir tout le portefeuille.
 */
export function ScopeToggle({ role, onChange }: { role: EmployeeRole; onChange: (role: EmployeeRole) => void }) {
  const scoped = role === "agent";
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={scoped}
        onChange={() => onChange(scoped ? "comptable" : "agent")}
        className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
      />
      <span>
        <span className="font-label-md text-ink">Limiter aux biens qui lui sont assignés</span>
        <span className="block text-body-xs text-ink-muted">
          Coché : il ne voit que les biens que vous lui attribuez (tant qu&apos;aucun bien n&apos;est attribué, il voit tout). Décoché : il voit tout le portefeuille, dans la limite de ses accès.
        </span>
      </span>
    </label>
  );
}
