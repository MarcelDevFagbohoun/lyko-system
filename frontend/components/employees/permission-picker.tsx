"use client";

import type { PermissionCatalogEntry, PermissionKey } from "@/lib/api/employees";
import { cn } from "@/lib/utils";

/** Sélecteur de permissions par module (section 5) — le DG coche ce que l'employé peut voir. */
export function PermissionPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: PermissionCatalogEntry[];
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
}) {
  function toggle(key: PermissionKey) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {catalog.map((perm) => {
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
