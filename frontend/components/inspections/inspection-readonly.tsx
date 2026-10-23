"use client";

import { formatFcfa } from "@/lib/utils";
import { CONDITION_LABELS } from "@/lib/constants/inspection";
import type { InspectionZone } from "@/lib/api/renters";
import { Badge } from "@/components/ui/badge";
import { conditionBadgeVariant } from "@/lib/constants/inspection";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";

/**
 * Affichage figé des zones/éléments d'une fiche finalisée — partagé entrée/sortie. Un tableau par pièce :
 * en-tête bleu à texte blanc, lignes blanches séparées de fins filets (même design que le PDF).
 */
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
    <div className="flex flex-col gap-6">
      {zones.map((zone) => (
        <div key={zone.key} className="flex flex-col gap-2">
          <h3 className="font-label-lg text-ink">{zone.label}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2 text-left font-label-md">Élément</th>
                  <th className="px-3 py-2 text-left font-label-md">État</th>
                  <th className="px-3 py-2 text-left font-label-md">Observations</th>
                  {showDeductions && <th className="px-3 py-2 text-right font-label-md">Retenue (FCFA)</th>}
                </tr>
              </thead>
              <tbody>
                {zone.items.map((item) => (
                  <tr key={item.key} className="border-b border-border-strong bg-surface align-top">
                    <td className="border-x border-border-strong px-3 py-2 font-label-md text-ink">{item.label}</td>
                    <td className="border-r border-border-strong px-3 py-2">
                      {item.condition ? (
                        <Badge variant={conditionBadgeVariant(item.condition)}>{CONDITION_LABELS[item.condition]}</Badge>
                      ) : (
                        <Badge variant="neutral">Non renseigné</Badge>
                      )}
                    </td>
                    <td className="border-r border-border-strong px-3 py-2 text-ink-soft">
                      {item.comment || <span className="text-ink-faint">—</span>}
                      {item.billing?.lines && item.billing.lines.length > 0 && (
                        <ul className="mt-1 text-body-xs text-ink-muted">
                          {item.billing.lines.map((l, idx) => (
                            <li key={idx}>
                              • {l.label}
                              {l.quantity > 1 ? ` × ${l.quantity}` : ""} — {formatFcfa(l.unitPrice * l.quantity)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.photoUrls.length > 0 && accessToken && (
                        <div className="mt-1.5 flex gap-1.5">
                          {item.photoUrls.map((url) => (
                            <AuthenticatedImage key={url} src={url} accessToken={accessToken} alt={item.label} className="h-16 w-16 rounded border border-border object-cover" />
                          ))}
                        </div>
                      )}
                    </td>
                    {showDeductions && (
                      <td className={`tabular border-r border-border-strong px-3 py-2 text-right font-label-md ${item.deduction > 0 ? "text-danger-fg" : "text-ink-faint"}`}>
                        {item.deduction > 0 ? `- ${formatFcfa(item.deduction)}` : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
