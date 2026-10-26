"use client";

import * as React from "react";
import { X, Search } from "lucide-react";
import { formatFcfa } from "@/lib/utils";
import type { BillingLine } from "@/lib/api/renters";
import type { CatalogItem } from "@/lib/api/inspectionCatalog";
import { Button } from "@/components/ui/button";


/**
 * Choix d'une ligne à facturer : recherche dans le catalogue de
 * l'entreprise (prix pré-rempli), ou saisie d'un élément non catalogué
 * (libellé + prix libres) — les deux ajoutent une ligne de la même forme.
 */
export function BillingPicker({
  catalog,
  onPick,
  onCancel,
}: {
  catalog: CatalogItem[];
  onPick: (line: BillingLine) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [customLabel, setCustomLabel] = React.useState("");
  const [customPrice, setCustomPrice] = React.useState("");

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? catalog.filter((c) => c.label.toLowerCase().includes(q)) : catalog;
    return list.slice(0, 8);
  }, [catalog, query]);

  function confirmCustom() {
    const price = Number(customPrice);
    if (!customLabel.trim() || !Number.isFinite(price) || price <= 0) return;
    onPick({ catalogItemId: null, label: customLabel.trim(), unitPrice: price, quantity: 1 });
    setCustomLabel("");
    setCustomPrice("");
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong bg-surface-muted p-3">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-ink-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher dans le catalogue (ex. Porte, Fenêtre…)"
          className="h-8 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button type="button" onClick={onCancel} className="text-ink-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>

      {matches.length > 0 ? (
        <div className="flex flex-col gap-1">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick({ catalogItemId: c.id, label: c.label, unitPrice: c.price, quantity: 1 })}
              className="flex items-center justify-between rounded px-2 py-1.5 text-body-sm text-ink hover:bg-surface-hover"
            >
              <span>{c.label}</span>
              <span className="tabular text-ink-soft">{formatFcfa(c.price)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2 text-body-xs text-ink-muted">
          {catalog.length === 0 ? "Le catalogue est vide pour l'instant." : "Aucun élément du catalogue ne correspond."}
        </p>
      )}

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="text-body-xs text-ink-muted">Élément non catalogué</span>
        <div className="flex items-center gap-2">
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Libellé"
            className="h-8 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            type="text"
            inputMode="numeric"
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value.replace(/\D/g, ""))}
            placeholder="Prix FCFA"
            className="h-8 w-28 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="button" size="sm" onClick={confirmCustom}>
            Ajouter
          </Button>
        </div>
      </div>
    </div>
  );
}

