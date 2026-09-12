"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Home, ExternalLink } from "lucide-react";
import { listProperties, getProperty, type PropertyListItem, type Unit } from "@/lib/api/properties";
import { unitDesignationLabel } from "@/lib/constants/properties";
import { formatFcfa, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const UNIT_STATUS_BADGE = {
  libre: { variant: "success" as const, label: "Libre" },
  loue: { variant: "neutral" as const, label: "Loué" },
  reserve: { variant: "warning" as const, label: "Réservé" },
};

/**
 * Sélection d'un Bien (par nom du propriétaire ou code, avec autocomplétion)
 * puis d'une Unité libre au sein de ce bien — workflow demandé : rechercher
 * le bien, voir ses unités avec statut, choisir l'unité disponible.
 */
export function PropertyUnitPicker({
  accessToken,
  selectedUnit,
  onSelect,
}: {
  accessToken: string | null;
  selectedUnit: Unit | null;
  onSelect: (unit: Unit, property: PropertyListItem) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PropertyListItem[]>([]);
  const [showResults, setShowResults] = React.useState(false);
  const [selectedProperty, setSelectedProperty] = React.useState<PropertyListItem | null>(null);
  const [units, setUnits] = React.useState<Unit[] | null>(null);
  const [loadingUnits, setLoadingUnits] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken || !showResults) return;
    const t = setTimeout(() => {
      listProperties(accessToken, query).then((res) => setResults(res.properties));
    }, 200);
    return () => clearTimeout(t);
  }, [query, accessToken, showResults]);

  async function handleSelectProperty(p: PropertyListItem) {
    setSelectedProperty(p);
    setShowResults(false);
    setQuery(`${p.code} — ${p.owner.name}`);
    if (!accessToken) return;
    setLoadingUnits(true);
    try {
      const res = await getProperty(accessToken, p.id);
      setUnits(res.units);
    } finally {
      setLoadingUnits(false);
    }
  }

  function reset() {
    setSelectedProperty(null);
    setUnits(null);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(true);
              if (selectedProperty) reset();
            }}
            onFocus={() => setShowResults(true)}
            placeholder="Rechercher un bien par propriétaire ou code (ex. BIEN-001)"
            className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        {showResults && query.length > 0 && !selectedProperty && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-md">
            {results.length === 0 ? (
              <div className="px-3 py-3 text-body-sm text-ink-muted">
                Aucun bien trouvé.{" "}
                <Link href="/espace/biens/nouveau" className="text-primary hover:underline">
                  En créer un
                </Link>
              </div>
            ) : (
              results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProperty(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-muted"
                >
                  <div>
                    <p className="font-label-md text-ink">{p.owner.name}</p>
                    <p className="text-body-xs text-ink-muted">{p.code}{p.address ? ` · ${p.address}` : ""}</p>
                  </div>
                  <Badge variant={p.unitsFree > 0 ? "success" : "neutral"}>
                    {p.unitsFree}/{p.unitsCount} libre{p.unitsFree > 1 ? "s" : ""}
                  </Badge>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {selectedProperty && (
        <div className="rounded-lg border border-border bg-surface-muted p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Home size={16} className="text-primary" />
              <span className="font-label-md text-ink">{selectedProperty.owner.name}</span>
              <span className="text-body-xs text-ink-muted">{selectedProperty.code}</span>
            </div>
            <Link
              href={`/espace/biens/${selectedProperty.id}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-body-xs text-primary hover:underline"
            >
              Voir le bien <ExternalLink size={12} />
            </Link>
          </div>

          {loadingUnits ? (
            <p className="text-body-sm text-ink-muted">Chargement des unités…</p>
          ) : units && units.length === 0 ? (
            <p className="text-body-sm text-ink-muted">
              Ce bien n&apos;a aucune unité. Ajoutez-en une depuis sa fiche.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {units?.map((u) => {
                const isFree = u.status === "libre";
                const isSelected = selectedUnit?.id === u.id;
                const badge = UNIT_STATUS_BADGE[u.status];
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={!isFree}
                    onClick={() => isFree && onSelect(u, selectedProperty)}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      !isFree && "cursor-not-allowed opacity-60",
                      isSelected ? "border-primary bg-surface ring-1 ring-primary" : "border-border bg-surface hover:bg-surface-hover",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-label-sm text-ink">{u.code}</span>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>
                    <span className="text-body-xs text-ink-soft">
                      {unitDesignationLabel(u.designation, u.designationCustom)}
                    </span>
                    <span className="tabular font-currency-table text-ink">{formatFcfa(u.monthlyRent)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
