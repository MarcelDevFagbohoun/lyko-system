"use client";

import { formatFcfa } from "@/lib/utils";
import { CONDITION_LABELS } from "@/lib/constants/inspection";
import type { InspectionZone } from "@/lib/api/renters";
import { Badge } from "@/components/ui/badge";
import { conditionBadgeVariant } from "@/lib/constants/inspection";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";

/** Affichage figé des zones/éléments d'une fiche finalisée — partagé entrée/sortie. */
export function InspectionReadOnly({
  zones,
  showDeductions,
  accessToken,
}: {
  zones: InspectionZone[];
  showDeductions: boolean;
  accessToken: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {zones.map((zone) => (
        <div key={zone.key} className="flex flex-col gap-2">
          <h3 className="font-label-lg text-ink">{zone.label}</h3>
          <div className="flex flex-col gap-2">
            {zone.items.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-label-md text-ink">{item.label}</p>
                  {item.comment && <p className="text-body-xs text-ink-muted">{item.comment}</p>}
                  {item.billing?.lines && item.billing.lines.length > 0 && (
                    <ul className="text-body-xs text-ink-muted">
                      {item.billing.lines.map((l, idx) => (
                        <li key={idx}>
                          • {l.label}
                          {l.quantity > 1 ? ` × ${l.quantity}` : ""} — {formatFcfa(l.unitPrice * l.quantity)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.photoUrls.length > 0 && accessToken && (
                    <div className="mt-1 flex gap-1.5">
                      {item.photoUrls.map((url) => (
                        <AuthenticatedImage
                          key={url}
                          src={url}
                          accessToken={accessToken}
                          alt={item.label}
                          className="h-20 w-20 rounded border border-border object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {showDeductions && item.deduction > 0 && (
                    <span className="tabular text-body-sm text-danger-fg">- {formatFcfa(item.deduction)}</span>
                  )}
                  {item.condition ? (
                    <Badge variant={conditionBadgeVariant(item.condition)}>{CONDITION_LABELS[item.condition]}</Badge>
                  ) : (
                    <Badge variant="neutral">Non renseigné</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
