"use client";

import type { PermissionCatalogEntry, PermissionKey } from "@/lib/api/employees";
import { ASSISTANT_ENABLED } from "@/lib/features";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";

const CHARGES_KEYS: PermissionKey[] = ["charges", "charges_enregistrer"];

/**
 * Sélecteur de permissions. Deux familles, volontairement séparées :
 * - « Accès aux écrans » : ce que l'employé peut consulter ;
 * - « Opérations » : ce qu'il peut enregistrer (versements, charges, dépenses). Avoir accès à une fiche
 *   ne donne jamais le droit d'enregistrer de l'argent : chaque opération se coche à part.
 * Les permissions « Charges » disparaissent si le module est désactivé dans Paramètres.
 */
export function PermissionPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: PermissionCatalogEntry[];
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
}) {
  const { tenant } = useAuth();
  const chargesOn = tenant?.chargesEnabled !== false;
  function toggle(key: PermissionKey) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  const visible = catalog.filter((p) => (ASSISTANT_ENABLED || p.key !== "assistant") && (chargesOn || !CHARGES_KEYS.includes(p.key)));
  const screens = visible.filter((p) => p.group !== "operations");
  const operations = visible.filter((p) => p.group === "operations");

  function renderGroup(items: PermissionCatalogEntry[]) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((perm) => {
          const checked = value.includes(perm.key);
          return (
            <label
              key={perm.key}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                checked ? "border-primary bg-surface-muted" : "border-border bg-surface hover:bg-surface-hover",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(perm.key)}
                className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
              />
              <span className="font-label-md text-ink">{perm.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Accès aux écrans</p>
        <p className="text-body-xs text-ink-muted">Ce que l&apos;employé peut consulter. Cela ne lui permet pas d&apos;enregistrer de l&apos;argent.</p>
        {renderGroup(screens)}
      </div>
      {operations.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-label-sm uppercase tracking-wider text-ink-muted">Opérations autorisées</p>
          <p className="text-body-xs text-ink-muted">Chaque opération financière se coche une par une. Sans la case, le bouton n&apos;apparaît pas et le serveur refuse.</p>
          {renderGroup(operations)}
        </div>
      )}
    </div>
  );
}
