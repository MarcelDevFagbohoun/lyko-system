"use client";

import * as React from "react";
import {
  Plus,
  X,
  Check,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  generateCustomKey,
  ROOM_PRESETS,
  COMMON_ITEM_SUGGESTIONS,
  nextRoomIdentity,
  itemKeyFromLabel,
  type InspectionCondition,
} from "@/lib/constants/inspection";
import { Button } from "@/components/ui/button";
import { ROOM_ICONS } from "./zone-section";

export function conditionButtonClass(c: InspectionCondition) {
  if (c === "BE") return "border-success bg-success-bg text-success-fg";
  if (c === "SR") return "border-warning bg-warning-bg text-warning-fg";
  return "border-danger bg-danger-bg text-danger-fg";
}

/**
 * Ajout d'une pièce (étape 56) : une pièce type pré-remplie de ses éléments habituels (« Chambre 2 » si
 * une chambre existe déjà), ou une pièce libre dont l'agent choisit le nom et les éléments.
 */
export function AddRoomPanel({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[];
  onAdd: (room: { key: string; label: string; items: { key: string; label: string }[] }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [customName, setCustomName] = React.useState("");
  const [customItems, setCustomItems] = React.useState<string[]>([]);
  const [customItemDraft, setCustomItemDraft] = React.useState("");

  function reset() {
    setOpen(false);
    setCustomName("");
    setCustomItems([]);
    setCustomItemDraft("");
  }

  function addPreset(preset: (typeof ROOM_PRESETS)[number]) {
    const { key, label } = nextRoomIdentity(preset, existingKeys);
    onAdd({ key, label, items: preset.items });
    reset();
  }

  function toggleCustomItem(label: string) {
    setCustomItems((items) => (items.includes(label) ? items.filter((l) => l !== label) : [...items, label]));
  }

  function addCustomItemDraft() {
    const label = customItemDraft.trim();
    if (label && !customItems.includes(label)) setCustomItems((items) => [...items, label]);
    setCustomItemDraft("");
  }

  function addCustomRoom() {
    if (!customName.trim() || customItems.length === 0) return;
    const keys: string[] = [];
    const items = customItems.map((label) => {
      const key = itemKeyFromLabel(label, keys);
      keys.push(key);
      return { key, label };
    });
    onAdd({ key: generateCustomKey("zone"), label: customName.trim(), items });
    reset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong bg-surface px-4 py-5 font-label-md text-ink-soft transition-colors hover:border-primary hover:bg-primary-bg/40 hover:text-primary"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-bg text-primary transition-transform group-hover:scale-110">
          <Plus size={18} />
        </span>
        Ajouter une pièce (salon, chambre, cuisine…)
      </button>
    );
  }

  return (
    <div className="flex animate-card-in flex-col gap-4 rounded-lg border border-primary/30 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-label-lg text-ink">Ajouter une pièce</h3>
          <p className="text-body-xs text-ink-muted">Une pièce type arrive avec ses éléments habituels, que vous pourrez modifier.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset} aria-label="Fermer">
          <X size={16} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {ROOM_PRESETS.map((preset, i) => {
          const Icon = ROOM_ICONS[preset.key] ?? LayoutGrid;
          const next = nextRoomIdentity(preset, existingKeys);
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => addPreset(preset)}
              className="flex animate-cell-pop items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
              style={{ animationDelay: `${i * 25}ms` }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-bg text-primary">
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-label-md text-ink">{next.label}</span>
                <span className="block text-body-xs text-ink-muted">{preset.items.length} éléments</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border pt-4">
        <p className="font-label-md text-ink">Ou une pièce libre</p>
        <input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Nom de la pièce (ex. Buanderie, Chambre d'enfant)"
          aria-label="Nom de la pièce libre"
          className="h-9 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <div className="flex flex-wrap gap-1.5">
          {[...COMMON_ITEM_SUGGESTIONS, ...customItems.filter((l) => !COMMON_ITEM_SUGGESTIONS.includes(l))].map((label) => {
            const selected = customItems.includes(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleCustomItem(label)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-body-xs transition-colors",
                  selected ? "border-primary bg-primary text-white" : "border-border-strong bg-surface text-ink-soft hover:border-primary",
                )}
              >
                {selected ? <Check size={12} /> : <Plus size={12} />}
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={customItemDraft}
            onChange={(e) => setCustomItemDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomItemDraft()}
            placeholder="Autre élément (ex. Chauffe-eau)"
            aria-label="Autre élément"
            className="h-9 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="button" variant="secondary" size="sm" onClick={addCustomItemDraft} disabled={!customItemDraft.trim()}>
            <Plus size={14} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={addCustomRoom} disabled={!customName.trim() || customItems.length === 0}>
            <Plus size={16} />
            Ajouter {customName.trim() ? `« ${customName.trim()} »` : "la pièce"}
            {customItems.length > 0 && ` (${customItems.length} élément${customItems.length > 1 ? "s" : ""})`}
          </Button>
          {(!customName.trim() || customItems.length === 0) && (
            <span className="text-body-xs text-ink-muted">Donnez un nom et choisissez au moins un élément.</span>
          )}
        </div>
      </div>
    </div>
  );
}
