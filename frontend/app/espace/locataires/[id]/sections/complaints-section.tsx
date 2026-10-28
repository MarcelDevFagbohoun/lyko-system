"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { listComplaints, type Complaint } from "@/lib/api/complaints";
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUS_BADGE_VARIANT } from "@/lib/constants/complaints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCan } from "@/lib/auth/use-can";


/**
 * Plaintes rattachées à ce bail (étape 7). N'apparaît que pour qui a la
 * permission dédiée `plaintes` — distincte de `locataires`, un agent peut
 * gérer les baux sans avoir accès à ce module (et inversement).
 */
export function ComplaintsSection({
  leaseId,
  renterId,
  accessToken,
}: {
  leaseId: number;
  renterId: number;
  accessToken: string | null;
}) {
  const canView = useCan("plaintes");
  const [complaints, setComplaints] = React.useState<Complaint[] | null>(null);

  React.useEffect(() => {
    if (!accessToken || !canView) return;
    listComplaints(accessToken, { leaseId }).then((res) => setComplaints(res.complaints));
  }, [accessToken, leaseId, canView]);

  if (!canView) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Plaintes & incidents</span>
        <Link href={`/espace/plaintes/nouveau?renterId=${renterId}`}>
          <Button variant="warning" size="sm">
            <Plus size={14} />
            Signaler un incident
          </Button>
        </Link>
      </div>

      {complaints === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : complaints.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune plainte enregistrée pour ce bail.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {complaints.map((c) => (
            <Link
              key={c.id}
              href={`/espace/plaintes/${c.id}`}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-muted"
            >
              <div className="flex items-center gap-2">
                {c.priority === "urgente" && <AlertTriangle size={14} className="text-danger-fg" />}
                <div>
                  <p className="font-label-sm text-ink">{c.code} — {c.title}</p>
                  <p className="text-body-xs text-ink-muted">Signalé le {c.reportedAt}</p>
                </div>
              </div>
              <Badge variant={COMPLAINT_STATUS_BADGE_VARIANT[c.status]}>
                {COMPLAINT_STATUS_LABELS[c.status]}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Charges SONEB/SBEE rattachées à ce bail (étape 9). Permission dédiée
 * `charges` — distincte de `locataires` ET de `comptabilite`, par défaut
 * réservée au comptable (catalogue de permissions de l'étape 3).
 */
