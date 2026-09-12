"use client";

import * as React from "react";
import { Search, UserRound } from "lucide-react";
import { listRenters, type RenterListItem } from "@/lib/api/renters";
import { cn } from "@/lib/utils";

/**
 * Sélection d'un locataire AVEC bail actif (une plainte se rattache toujours
 * à un bail en cours). Recherche côté client par nom ou téléphone — le
 * volume de locataires par cabinet reste raisonnable pour cette étape.
 */
export function RenterLeasePicker({
  accessToken,
  selectedRenterId,
  onSelect,
}: {
  accessToken: string | null;
  selectedRenterId: number | null;
  onSelect: (renter: RenterListItem) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [showResults, setShowResults] = React.useState(false);
  const [renters, setRenters] = React.useState<RenterListItem[] | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listRenters(accessToken).then((res) => setRenters(res.renters));
  }, [accessToken]);

  const eligible = (renters ?? []).filter((r) => r.activeLease !== null);
  const results = query.trim()
    ? eligible.filter((r) => {
        const q = query.trim().toLowerCase();
        return `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || r.phone.includes(q);
      })
    : eligible;

  const selected = eligible.find((r) => r.id === selectedRenterId) ?? null;

  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          value={selected && !showResults ? `${selected.firstName} ${selected.lastName} — ${selected.phone}` : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          placeholder="Rechercher un locataire par nom ou téléphone"
          className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      {showResults && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-md">
          {renters === null ? (
            <div className="px-3 py-3 text-body-sm text-ink-muted">Chargement…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-body-sm text-ink-muted">
              Aucun locataire avec bail actif ne correspond.
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQuery("");
                  setShowResults(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-muted",
                  selectedRenterId === r.id && "bg-surface-muted",
                )}
              >
                <UserRound size={14} className="text-ink-muted" />
                <div>
                  <p className="font-label-md text-ink">{r.firstName} {r.lastName}</p>
                  <p className="text-body-xs text-ink-muted">
                    {r.phone} · {r.activeLease?.unit.designationLabel} ({r.activeLease?.unit.code})
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
