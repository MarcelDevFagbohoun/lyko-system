"use client";



import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { itemKeyFromLabel } from "@/lib/constants/inspection";
import type { InspectionZone, InspectionItem } from "@/lib/api/renters";
import type { CatalogItem } from "@/lib/api/inspectionCatalog";
import { AddRoomPanel } from "./sections/add-room-panel";
import { ZoneSection } from "./sections/zone-section";

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

