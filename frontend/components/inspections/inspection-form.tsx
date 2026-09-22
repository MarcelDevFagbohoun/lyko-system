"use client";

import * as React from "react";
import { Camera, Plus, Trash2, X, Search, Receipt } from "lucide-react";
import { cn, formatFcfa } from "@/lib/utils";
import { API_URL } from "@/lib/api/client";
import {
  INSPECTION_CONDITIONS,
  CONDITION_LABELS,
  generateCustomKey,
  type InspectionCondition,
} from "@/lib/constants/inspection";
import type { InspectionZone, InspectionItem, BillingLine } from "@/lib/api/renters";
import type { CatalogItem } from "@/lib/api/inspectionCatalog";
import { Button } from "@/components/ui/button";

type InspectionFormProps = {
  zones: InspectionZone[];
  onChange: (zones: InspectionZone[]) => void;
  showDeductions: boolean;
  onUploadPhoto: (zoneKey: string, itemKey: string, file: File) => void | Promise<void>;
  onDeletePhoto: (zoneKey: string, itemKey: string) => void | Promise<void>;
  /** Référentiel de prix (uniquement utile quand `showDeductions`), pour proposer un prix plutôt que le saisir à l'aveugle. */
  catalog?: CatalogItem[];
  /** Postes dégradés par rapport à l'entrée ("zoneKey::itemKey") — mis en évidence avec une invite à facturer. */
  degradedKeys?: Set<string>;
}

/**
 * Éditeur de brouillon d'état des lieux (étape 13, idée n°9 : refonte par
 * zones) — partagé entre l'entrée et la sortie. Purement présentationnel :
 * ne parle jamais directement à l'API (sauf les photos, immédiates par
 * nature) — l'appelant décide quand persister `zones` (bouton Enregistrer).
 */
export function InspectionForm({
  zones,
  onChange,
  showDeductions,
  onUploadPhoto,
  onDeletePhoto,
  catalog = [],
  degradedKeys,
}: InspectionFormProps) {
  function updateItem(zoneKey: string, itemKey: string, patch: Partial<InspectionItem>) {
    onChange(
      zones.map((zone) =>
        zone.key !== zoneKey
          ? zone
          : { ...zone, items: zone.items.map((item) => (item.key !== itemKey ? item : { ...item, ...patch })) },
      ),
    );
  }

  function removeItem(zoneKey: string, itemKey: string) {
    onChange(
      zones.map((zone) => (zone.key !== zoneKey ? zone : { ...zone, items: zone.items.filter((it) => it.key !== itemKey) })),
    );
  }

  function addItem(zoneKey: string, label: string) {
    const key = generateCustomKey("item");
    onChange(
      zones.map((zone) =>
        zone.key !== zoneKey
          ? zone
          : { ...zone, items: [...zone.items, { key, label, custom: true, condition: null, comment: null, photoUrl: null, deduction: 0, billing: null }] },
      ),
    );
  }

  function addZone(label: string, firstItemLabel: string) {
    const zoneKey = generateCustomKey("zone");
    const itemKey = generateCustomKey("item");
    onChange([
      ...zones,
      {
        key: zoneKey,
        label,
        custom: true,
        items: [{ key: itemKey, label: firstItemLabel, custom: true, condition: null, comment: null, photoUrl: null, deduction: 0, billing: null }],
      },
    ]);
  }

  function removeZone(zoneKey: string) {
    onChange(zones.filter((z) => z.key !== zoneKey));
  }

  return (
    <div className="flex flex-col gap-6">
      {zones.map((zone) => (
        <ZoneSection
          key={zone.key}
          zone={zone}
          showDeductions={showDeductions}
          catalog={catalog}
          degradedKeys={degradedKeys}
          onUpdateItem={(itemKey, patch) => updateItem(zone.key, itemKey, patch)}
          onRemoveItem={(itemKey) => removeItem(zone.key, itemKey)}
          onAddItem={(label) => addItem(zone.key, label)}
          onRemoveZone={() => removeZone(zone.key)}
          onUploadPhoto={(itemKey, file) => onUploadPhoto(zone.key, itemKey, file)}
          onDeletePhoto={(itemKey) => onDeletePhoto(zone.key, itemKey)}
        />
      ))}
      <AddZoneForm onAdd={addZone} />
    </div>
  );
}

function ZoneSection({
  zone,
  showDeductions,
  catalog,
  degradedKeys,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onRemoveZone,
  onUploadPhoto,
  onDeletePhoto,
}: {
  zone: InspectionZone;
  showDeductions: boolean;
  catalog: CatalogItem[];
  degradedKeys?: Set<string>;
  onUpdateItem: (itemKey: string, patch: Partial<InspectionItem>) => void;
  onRemoveItem: (itemKey: string) => void;
  onAddItem: (label: string) => void;
  onRemoveZone: () => void;
  onUploadPhoto: (itemKey: string, file: File) => void | Promise<void>;
  onDeletePhoto: (itemKey: string) => void | Promise<void>;
}) {
  const [addingItem, setAddingItem] = React.useState(false);
  const [newItemLabel, setNewItemLabel] = React.useState("");

  function confirmAddItem() {
    if (!newItemLabel.trim()) return;
    onAddItem(newItemLabel.trim());
    setNewItemLabel("");
    setAddingItem(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-label-lg text-ink">{zone.label}</h3>
          {zone.custom && <span className="rounded-full bg-info-bg px-2 py-0.5 text-body-xs text-info-fg">Zone personnalisée</span>}
        </div>
        {zone.custom && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemoveZone}>
            <Trash2 size={14} />
            Supprimer la zone
          </Button>
        )}
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
            onRemove={item.custom ? () => onRemoveItem(item.key) : undefined}
            onUploadPhoto={(file) => onUploadPhoto(item.key, file)}
            onDeletePhoto={() => onDeletePhoto(item.key)}
          />
        ))}
      </div>

      {addingItem ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmAddItem()}
            placeholder="Nom de l'élément (ex. Garage)"
            className="h-9 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="button" size="sm" onClick={confirmAddItem}>Ajouter</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingItem(false); setNewItemLabel(""); }}>
            <X size={14} />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAddingItem(true)}>
          <Plus size={14} />
          Ajouter un élément
        </Button>
      )}
    </div>
  );
}

function ItemRow({
  item,
  showDeductions,
  catalog,
  degraded,
  onUpdate,
  onRemove,
  onUploadPhoto,
  onDeletePhoto,
}: {
  item: InspectionItem;
  showDeductions: boolean;
  catalog: CatalogItem[];
  degraded: boolean;
  onUpdate: (patch: Partial<InspectionItem>) => void;
  onRemove?: () => void;
  onUploadPhoto: (file: File) => void | Promise<void>;
  onDeletePhoto: () => void | Promise<void>;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const lines = item.billing?.lines ?? [];

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await onUploadPhoto(file);
    } finally {
      setUploading(false);
    }
  }

  // Miroir côté client de `computeItemDeduction` (backend) : le serveur fait
  // foi à l'enregistrement, mais `item.deduction` doit refléter les lignes
  // immédiatement à l'écran, sans attendre un aller-retour réseau.
  function sumLines(ls: BillingLine[]) {
    return ls.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  }

  function addLine(line: BillingLine) {
    const existingIdx = line.catalogItemId != null ? lines.findIndex((l) => l.catalogItemId === line.catalogItemId) : -1;
    const newLines =
      existingIdx >= 0
        ? lines.map((l, i) => (i === existingIdx ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, line];
    onUpdate({ billing: { lines: newLines }, deduction: sumLines(newLines) });
    setPickerOpen(false);
  }

  function updateLineQuantity(idx: number, quantity: number) {
    const newLines = lines.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, quantity) } : l));
    onUpdate({ billing: { lines: newLines }, deduction: sumLines(newLines) });
  }

  function removeLine(idx: number) {
    const remaining = lines.filter((_, i) => i !== idx);
    onUpdate({ billing: remaining.length > 0 ? { lines: remaining } : null, deduction: sumLines(remaining) });
  }

  return (
    <div className={cn("rounded-lg border p-3", degraded && lines.length === 0 ? "border-warning-border bg-warning-bg" : "border-border")}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <span className="font-label-md text-ink">
          {item.label}
          {item.custom && <span className="ml-1.5 text-body-xs text-ink-muted">(personnalisé)</span>}
        </span>
        <div className="flex items-center gap-1.5">
          {INSPECTION_CONDITIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onUpdate({ condition: c })}
              className={cn(
                "rounded-full border px-3 py-1 font-label-sm transition-colors",
                item.condition === c ? conditionButtonClass(c) : "border-border text-ink-soft hover:bg-surface-hover",
              )}
            >
              {c}
            </button>
          ))}
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-ink-muted hover:text-danger-fg">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {item.condition && <p className="mt-1 text-body-xs text-ink-muted">{CONDITION_LABELS[item.condition]}</p>}
      {degraded && lines.length === 0 && (
        <p className="mt-1 text-body-xs font-label-sm text-warning-fg">Dégradé depuis l&apos;entrée — facturer ce dommage ?</p>
      )}

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        <input
          type="text"
          placeholder="Observation (optionnel)"
          value={item.comment ?? ""}
          onChange={(e) => onUpdate({ comment: e.target.value || null })}
          className="h-8 flex-1 rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {showDeductions && lines.length === 0 && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="Retenue FCFA"
            value={item.deduction || ""}
            onChange={(e) => onUpdate({ deduction: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            className="h-8 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-32"
          />
        )}
      </div>

      {showDeductions && lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5 rounded border border-border-strong bg-surface p-2">
          {lines.map((l, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 text-body-xs">
              <span className="text-ink">{l.label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={l.quantity}
                  onChange={(e) => updateLineQuantity(idx, Number(e.target.value.replace(/\D/g, "")) || 1)}
                  className="h-6 w-10 rounded border border-border-strong bg-surface text-center text-body-xs text-ink"
                />
                <span className="tabular text-ink-soft">{formatFcfa(l.unitPrice * l.quantity)}</span>
                <button type="button" onClick={() => removeLine(idx)} className="text-ink-muted hover:text-danger-fg">
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border pt-1.5 text-body-xs">
            <span className="font-label-sm text-ink">Total facturé</span>
            <span className="tabular font-label-sm text-danger-fg">{formatFcfa(item.deduction)}</span>
          </div>
        </div>
      )}

      {showDeductions && (
        <div className="mt-2">
          {pickerOpen ? (
            <BillingPicker catalog={catalog} onPick={addLine} onCancel={() => setPickerOpen(false)} />
          ) : (
            <Button
              type="button"
              variant={degraded && lines.length === 0 ? "warning" : "ghost"}
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              <Receipt size={14} />
              {lines.length > 0 ? "Ajouter une ligne" : "Facturer ce dommage"}
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {item.photoUrl ? (
          <div className="relative h-16 w-16 overflow-hidden rounded border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${API_URL}${item.photoUrl}`} alt={item.label} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onDeletePhoto()}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-9 items-center gap-1.5 rounded border border-dashed border-border px-3 text-body-xs text-ink-muted hover:text-ink disabled:opacity-60"
          >
            <Camera size={14} />
            {uploading ? "Envoi…" : "Photo (optionnel)"}
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} className="hidden" />
      </div>
    </div>
  );
}

/**
 * Choix d'une ligne à facturer : recherche dans le catalogue de
 * l'entreprise (prix pré-rempli), ou saisie d'un élément non catalogué
 * (libellé + prix libres) — les deux ajoutent une ligne de la même forme.
 */
function BillingPicker({
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

function conditionButtonClass(c: InspectionCondition) {
  if (c === "BE") return "border-success bg-success-bg text-success-fg";
  if (c === "SR") return "border-warning bg-warning-bg text-warning-fg";
  return "border-danger bg-danger-bg text-danger-fg";
}

function AddZoneForm({ onAdd }: { onAdd: (label: string, firstItemLabel: string) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [zoneLabel, setZoneLabel] = React.useState("");
  const [itemLabel, setItemLabel] = React.useState("");

  function confirm() {
    if (!zoneLabel.trim() || !itemLabel.trim()) return;
    onAdd(zoneLabel.trim(), itemLabel.trim());
    setZoneLabel("");
    setItemLabel("");
    setAdding(false);
  }

  if (!adding) {
    return (
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
        <Plus size={14} />
        Ajouter une zone (garage, cour, couloir…)
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="mb-1 block text-body-xs text-ink-muted">Nom de la zone</label>
        <input
          autoFocus
          value={zoneLabel}
          onChange={(e) => setZoneLabel(e.target.value)}
          placeholder="Ex. Garage"
          className="h-9 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-body-xs text-ink-muted">Premier élément à vérifier</label>
        <input
          value={itemLabel}
          onChange={(e) => setItemLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder="Ex. Porte de garage"
          className="h-9 w-full rounded border border-border-strong bg-surface px-2.5 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={confirm}>Ajouter</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
