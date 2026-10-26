"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  X,
  Pencil,
  Home,
  BedDouble,
  Sofa,
  CookingPot,
  ShowerHead,
  DoorOpen,
  Bath,
  Sun,
  Trees,
  Car,
  Briefcase,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMMON_ITEM_SUGGESTIONS, presetForZoneKey } from "@/lib/constants/inspection";
import type { InspectionZone, InspectionItem } from "@/lib/api/renters";
import type { CatalogItem } from "@/lib/api/inspectionCatalog";
import { Button } from "@/components/ui/button";
import { ItemRow } from "./item-row";

export const ROOM_ICONS: Record<string, LucideIcon> = {
  devanture: Home,
  chambre: BedDouble,
  salon: Sofa,
  cuisine: CookingPot,
  douche_sdb: ShowerHead,
  entree_couloir: DoorOpen,
  wc: Bath,
  balcon: Sun,
  cour: Trees,
  garage: Car,
  bureau: Briefcase,
};

export function roomIcon(zoneKey: string): LucideIcon {
  const preset = presetForZoneKey(zoneKey);
  return (preset && ROOM_ICONS[preset.key]) || LayoutGrid;
}

export function ZoneSection({
  zone,
  highlight,
  removable,
  isItemLocked,
  showDeductions,
  catalog,
  degradedKeys,
  onUpdateItem,
  onRemoveItem,
  onAddItems,
  onRename,
  onRemoveZone,
  onUploadPhoto,
  onDeletePhoto,
  accessToken,
}: {
  zone: InspectionZone;
  highlight: boolean;
  removable: boolean;
  isItemLocked: (itemKey: string) => boolean;
  showDeductions: boolean;
  catalog: CatalogItem[];
  degradedKeys?: Set<string>;
  onUpdateItem: (itemKey: string, patch: Partial<InspectionItem>) => void;
  onRemoveItem: (itemKey: string) => void;
  onAddItems: (labels: string[]) => void;
  onRename: (label: string) => void;
  onRemoveZone: () => void;
  onUploadPhoto: (itemKey: string, file: File) => void | Promise<void>;
  onDeletePhoto: (itemKey: string, photoIndex: number) => void | Promise<void>;
  accessToken: string | null;
}) {
  const [addingItem, setAddingItem] = React.useState(false);
  const [newItemLabel, setNewItemLabel] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState(zone.label);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const Icon = roomIcon(zone.key);

  // Une pièce qui vient d'être ajoutée défile à l'écran, pour que l'agent la voie tout de suite.
  React.useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight]);

  const existingLabels = new Set(zone.items.map((it) => it.label.toLowerCase()));
  const preset = presetForZoneKey(zone.key);
  const suggestions = [...(preset?.items.map((it) => it.label) ?? []), ...COMMON_ITEM_SUGGESTIONS]
    .filter((label, i, all) => all.indexOf(label) === i && !existingLabels.has(label.toLowerCase()))
    .slice(0, 10);

  const done = zone.items.filter((it) => it.condition).length;

  function confirmAddItem() {
    if (!newItemLabel.trim()) return;
    onAddItems([newItemLabel.trim()]);
    setNewItemLabel("");
  }

  function confirmRename() {
    if (labelDraft.trim()) onRename(labelDraft.trim());
    setRenaming(false);
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex scroll-mt-24 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm",
        highlight && "animate-card-in border-primary/40 ring-2 ring-primary/15",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-bg text-primary">
            <Icon size={18} />
          </span>
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Nom de la pièce"
                className="h-9 w-48 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <Button type="button" size="sm" onClick={confirmRename}>
                OK
              </Button>
            </div>
          ) : (
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 font-label-lg text-ink">
                {zone.label}
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(zone.label);
                    setRenaming(true);
                  }}
                  aria-label={`Renommer ${zone.label}`}
                  className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <Pencil size={13} />
                </button>
              </h3>
              <p className="text-body-xs text-ink-muted">
                {done}/{zone.items.length} élément{zone.items.length > 1 ? "s" : ""} renseigné{done > 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
        {removable &&
          (confirmingRemove ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-danger-border bg-danger-bg px-2 py-1">
              <span className="text-body-xs text-danger-fg">Retirer « {zone.label} » ?</span>
              <Button type="button" size="sm" variant="destructive" onClick={onRemoveZone}>
                Oui
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
                Non
              </Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)}>
              <Trash2 size={14} />
              Retirer la pièce
            </Button>
          ))}
      </div>

      <div className="flex flex-col gap-3">
        {zone.items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            showDeductions={showDeductions}
            catalog={catalog}
            degraded={degradedKeys?.has(`${zone.key}::${item.key}`) ?? false}
            onUpdate={(patch) => onUpdateItem(item.key, patch)}
            onRemove={!isItemLocked(item.key) && zone.items.length > 1 ? () => onRemoveItem(item.key) : undefined}
            onUploadPhoto={(file) => onUploadPhoto(item.key, file)}
            onDeletePhoto={(photoIndex) => onDeletePhoto(item.key, photoIndex)}
            accessToken={accessToken}
          />
        ))}
      </div>

      {addingItem ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-dashed border-border-strong bg-surface-muted p-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmAddItem()}
              placeholder="Nom de l'élément (ex. Tableau électrique)"
              aria-label="Nom de l'élément"
              className="h-9 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <Button type="button" size="sm" onClick={confirmAddItem} disabled={!newItemLabel.trim()}>
              Ajouter
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingItem(false); setNewItemLabel(""); }} aria-label="Fermer">
              <X size={14} />
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-body-xs text-ink-muted">En un clic :</span>
              {suggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onAddItems([label])}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface px-2.5 py-1 text-body-xs text-ink-soft transition-colors hover:border-primary hover:text-primary"
                >
                  <Plus size={12} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAddingItem(true)}>
          <Plus size={14} />
          Ajouter un élément à {zone.label}
        </Button>
      )}
    </div>
  );
}

