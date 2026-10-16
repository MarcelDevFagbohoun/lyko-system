"use client";

import * as React from "react";
import {
  Camera,
  Plus,
  Trash2,
  X,
  Search,
  Receipt,
  Check,
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
import { cn, formatFcfa } from "@/lib/utils";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import {
  INSPECTION_CONDITIONS,
  CONDITION_LABELS,
  generateCustomKey,
  ROOM_PRESETS,
  COMMON_ITEM_SUGGESTIONS,
  presetForZoneKey,
  nextRoomIdentity,
  itemKeyFromLabel,
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
  onDeletePhoto: (zoneKey: string, itemKey: string, photoIndex: number) => void | Promise<void>;
  /** Référentiel de prix (uniquement utile quand `showDeductions`), pour proposer un prix plutôt que le saisir à l'aveugle. */
  catalog?: CatalogItem[];
  /** Postes dégradés par rapport à l'entrée ("zoneKey::itemKey") — mis en évidence avec une invite à facturer. */
  degradedKeys?: Set<string>;
  /**
   * Pièces (« zoneKey ») et éléments (« zoneKey::itemKey ») qu'on ne peut pas retirer — à la sortie, ceux
   * de la fiche d'entrée : les retirer ferait disparaître leur comparaison. Absent à l'entrée : tout se retire.
   */
  lockedKeys?: Set<string>;
  accessToken: string | null;
}

function newItem(key: string, label: string): InspectionItem {
  return { key, label, custom: true, condition: null, comment: null, photoUrls: [], deduction: 0, billing: null };
}

/**
 * Éditeur de brouillon d'état des lieux (étape 13, idée n°9 : refonte par
 * zones) — partagé entre l'entrée et la sortie. Purement présentationnel :
 * ne parle jamais directement à l'API (sauf les photos, immédiates par
 * nature) — l'appelant décide quand persister `zones` (bouton Enregistrer).
 *
 * Étape 56 : chaque pièce se compose librement — ajouter une pièce type (Salon, Chambre 2…) avec ses
 * éléments habituels ou une pièce libre, la renommer, la retirer, et ajouter ou retirer ses éléments
 * en un clic (suggestions), sauf ce que `lockedKeys` protège.
 */
export function InspectionForm({
  zones,
  onChange,
  showDeductions,
  onUploadPhoto,
  onDeletePhoto,
  catalog = [],
  degradedKeys,
  lockedKeys,
  accessToken,
}: InspectionFormProps) {
  const [lastAddedZone, setLastAddedZone] = React.useState<string | null>(null);

  function updateZone(zoneKey: string, update: (zone: InspectionZone) => InspectionZone) {
    onChange(zones.map((zone) => (zone.key !== zoneKey ? zone : update(zone))));
  }

  function updateItem(zoneKey: string, itemKey: string, patch: Partial<InspectionItem>) {
    updateZone(zoneKey, (zone) => ({ ...zone, items: zone.items.map((item) => (item.key !== itemKey ? item : { ...item, ...patch })) }));
  }

  function removeItem(zoneKey: string, itemKey: string) {
    updateZone(zoneKey, (zone) => ({ ...zone, items: zone.items.filter((it) => it.key !== itemKey) }));
  }

  function addItems(zoneKey: string, labels: string[]) {
    updateZone(zoneKey, (zone) => {
      const keys = zone.items.map((it) => it.key);
      const added: InspectionItem[] = [];
      for (const label of labels) {
        const key = itemKeyFromLabel(label, [...keys, ...added.map((a) => a.key)]);
        added.push(newItem(key, label));
      }
      return { ...zone, items: [...zone.items, ...added] };
    });
  }

  function addRoom(room: { key: string; label: string; items: { key: string; label: string }[] }) {
    onChange([...zones, { key: room.key, label: room.label, custom: true, items: room.items.map((it) => newItem(it.key, it.label)) }]);
    setLastAddedZone(room.key);
  }

  const doneCount = zones.reduce((n, z) => n + z.items.filter((it) => it.condition).length, 0);
  const totalCount = zones.reduce((n, z) => n + z.items.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
        <span className="font-label-md text-ink">
          {zones.length} pièce{zones.length > 1 ? "s" : ""} · {doneCount}/{totalCount} élément{totalCount > 1 ? "s" : ""} renseigné
          {doneCount > 1 ? "s" : ""}
        </span>
        <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", doneCount === totalCount && totalCount > 0 ? "bg-success" : "bg-primary")}
            style={{ width: `${totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%` }}
          />
        </div>
        {doneCount === totalCount && totalCount > 0 && (
          <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-success-fg">
            <Check size={15} />
            Prêt à signer
          </span>
        )}
      </div>

      {zones.map((zone) => (
        <ZoneSection
          key={zone.key}
          zone={zone}
          highlight={zone.key === lastAddedZone}
          removable={!lockedKeys?.has(zone.key)}
          isItemLocked={(itemKey) => lockedKeys?.has(`${zone.key}::${itemKey}`) ?? false}
          showDeductions={showDeductions}
          catalog={catalog}
          degradedKeys={degradedKeys}
          onUpdateItem={(itemKey, patch) => updateItem(zone.key, itemKey, patch)}
          onRemoveItem={(itemKey) => removeItem(zone.key, itemKey)}
          onAddItems={(labels) => addItems(zone.key, labels)}
          onRename={(label) => updateZone(zone.key, (z) => ({ ...z, label }))}
          onRemoveZone={() => onChange(zones.filter((z) => z.key !== zone.key))}
          onUploadPhoto={(itemKey, file) => onUploadPhoto(zone.key, itemKey, file)}
          onDeletePhoto={(itemKey, photoIndex) => onDeletePhoto(zone.key, itemKey, photoIndex)}
          accessToken={accessToken}
        />
      ))}
      <AddRoomPanel existingKeys={zones.map((z) => z.key)} onAdd={addRoom} />
    </div>
  );
}

const ROOM_ICONS: Record<string, LucideIcon> = {
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

function roomIcon(zoneKey: string): LucideIcon {
  const preset = presetForZoneKey(zoneKey);
  return (preset && ROOM_ICONS[preset.key]) || LayoutGrid;
}

function ZoneSection({
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

function ItemRow({
  item,
  showDeductions,
  catalog,
  degraded,
  onUpdate,
  onRemove,
  onUploadPhoto,
  onDeletePhoto,
  accessToken,
}: {
  item: InspectionItem;
  showDeductions: boolean;
  catalog: CatalogItem[];
  degraded: boolean;
  onUpdate: (patch: Partial<InspectionItem>) => void;
  onRemove?: () => void;
  onUploadPhoto: (file: File) => void | Promise<void>;
  onDeletePhoto: (photoIndex: number) => void | Promise<void>;
  accessToken: string | null;
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
              title={CONDITION_LABELS[c]}
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
        {item.photoUrls.map((url, idx) => (
          <div key={url} className="relative h-16 w-16 overflow-hidden rounded border border-border">
            {accessToken && (
              <AuthenticatedImage src={url} accessToken={accessToken} alt={item.label} className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => onDeletePhoto(idx)}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {item.photoUrls.length < 3 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-9 items-center gap-1.5 rounded border border-dashed border-border px-3 text-body-xs text-ink-muted hover:text-ink disabled:opacity-60"
          >
            <Camera size={14} />
            {uploading ? "Envoi…" : item.photoUrls.length > 0 ? "Ajouter" : "Photo (optionnel)"}
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

/**
 * Ajout d'une pièce (étape 56) : une pièce type pré-remplie de ses éléments habituels (« Chambre 2 » si
 * une chambre existe déjà), ou une pièce libre dont l'agent choisit le nom et les éléments.
 */
function AddRoomPanel({
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
