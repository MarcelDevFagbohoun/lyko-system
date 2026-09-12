"use client";

import * as React from "react";
import { Search, UserRound, Plus } from "lucide-react";
import { listOwners, createOwner, type OwnerListItem } from "@/lib/api/owners";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Sélection d'un Propriétaire existant (recherche par nom) avec repli sur une
 * création rapide (nom + téléphone) sans quitter le formulaire du Bien —
 * le Bien référence désormais une fiche Propriétaire (étape 5) au lieu d'un
 * simple texte libre.
 */
export function OwnerPicker({
  accessToken,
  selectedOwner,
  onSelect,
}: {
  accessToken: string | null;
  selectedOwner: OwnerListItem | null;
  onSelect: (owner: OwnerListItem) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<OwnerListItem[]>([]);
  const [showResults, setShowResults] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !showResults) return;
    const t = setTimeout(() => {
      listOwners(accessToken, query).then((res) => setResults(res.owners));
    }, 200);
    return () => clearTimeout(t);
  }, [query, accessToken, showResults]);

  function handleSelect(owner: OwnerListItem) {
    setShowResults(false);
    setQuery(owner.name);
    onSelect(owner);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createOwner(accessToken, { name: newName.trim(), phone: newPhone.trim() || undefined });
      const owner: OwnerListItem = {
        id: res.ownerId,
        name: newName.trim(),
        phone: newPhone.trim() || null,
        email: null,
        address: null,
        notes: null,
        createdBy: null,
        createdAt: new Date().toISOString(),
        propertiesCount: 0,
        unitsCount: 0,
        unitsOccupied: 0,
        monthlyRentTotal: 0,
      };
      setCreating(false);
      setNewName("");
      setNewPhone("");
      handleSelect(owner);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce propriétaire.");
    } finally {
      setSubmitting(false);
    }
  }

  if (creating) {
    return (
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nom du propriétaire" htmlFor="newOwnerName" required>
            <Input id="newOwnerName" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
          <Field label="Téléphone (optionnel)" htmlFor="newOwnerPhone" hint="Ex. 0161234567">
            <Input id="newOwnerPhone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={submitting || !newName.trim()}>
            {submitting ? "Création…" : "Créer et sélectionner"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={submitting}>
            Annuler
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          placeholder="Rechercher un propriétaire par nom"
          className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />

        {showResults && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-md">
            {results
              .filter((o) => !query || o.name.toLowerCase().includes(query.toLowerCase()))
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-muted",
                    selectedOwner?.id === o.id && "bg-surface-muted",
                  )}
                >
                  <UserRound size={14} className="text-ink-muted" />
                  <div>
                    <p className="font-label-md text-ink">{o.name}</p>
                    {o.phone && <p className="text-body-xs text-ink-muted">{o.phone}</p>}
                  </div>
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setShowResults(false);
                setNewName(query);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-primary hover:bg-surface-muted"
            >
              <Plus size={14} />
              Nouveau propriétaire{query ? ` « ${query} »` : ""}
            </button>
          </div>
        )}
      </div>

      {selectedOwner && !showResults && (
        <p className="text-body-xs text-success-fg">
          Propriétaire sélectionné : {selectedOwner.name}
          {selectedOwner.phone ? ` · ${selectedOwner.phone}` : ""}
        </p>
      )}
    </div>
  );
}
