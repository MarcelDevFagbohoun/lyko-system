"use client";

import * as React from "react";
import {
  Camera,
  Trash2,
  X,
  Receipt,
} from "lucide-react";
import { cn, formatFcfa } from "@/lib/utils";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { INSPECTION_CONDITIONS, CONDITION_LABELS } from "@/lib/constants/inspection";
import type { InspectionItem, BillingLine } from "@/lib/api/renters";
import type { CatalogItem } from "@/lib/api/inspectionCatalog";
import { Button } from "@/components/ui/button";
import { conditionButtonClass } from "./add-room-panel";
import { BillingPicker } from "./billing-picker";

export function ItemRow({
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
