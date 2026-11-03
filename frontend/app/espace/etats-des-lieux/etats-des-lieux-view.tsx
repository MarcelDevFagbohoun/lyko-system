"use client";

import * as React from "react";
import Link from "next/link";
import { Inbox, ClipboardList, Send, AlertTriangle, CheckCircle2, Archive } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useCan } from "@/lib/auth/use-can";
import { getInProgressInspections, archiveMoveOutReport, type InProgressInspectionItem } from "@/lib/api/renters";
import { ApiError } from "@/lib/api/client";
import { formatDateLabel } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Boîte « État des lieux » (demande utilisateur, 2026-11-03 : « comme une boîte mail ») : tout état
 * des lieux lancé par un employé tombe ici et y reste jusqu'à sa phase terminale — une entrée jusqu'à
 * sa finalisation, une sortie jusqu'à son ARCHIVAGE MANUEL (voir `MoveOutReport.leaseArchivedAt`).
 * L'employé y retrouve les siens pour les reprendre ; le DG/comptable peut agir sur n'importe lequel
 * jusqu'au bout, puis cliquer « Archivé » une fois le décaissement réglé — sans ce clic, le locataire
 * ne quitte jamais cette boîte pour l'onglet Archives (voir `locataires-view.tsx`).
 */
export function EtatsDesLieuxView() {
  return (
    <RequireAuth>
      <EtatsDesLieuxContent />
    </RequireAuth>
  );
}

type RowTone = "danger" | "warning" | "info" | "success" | "neutral";

function statusInfo(item: InProgressInspectionItem): { label: string; tone: RowTone; detail: string } {
  if (item.kind === "move-in") {
    return { label: "Entrée en brouillon", tone: "info", detail: "Pas encore finalisée." };
  }
  switch (item.reviewStatus) {
    case "rejected":
      return { label: "Rejetée par le DG", tone: "danger", detail: "À corriger puis resoumettre." };
    case "submitted":
      return { label: "En attente de validation", tone: "warning", detail: "Soumise au DG." };
    case "validated":
    case "draft":
    default:
      break;
  }
  if (item.status === "finalized") {
    if (item.payoutStatus === "pending") {
      return { label: "Décaissement en attente", tone: "warning", detail: "Caution à restituer ou complément à encaisser." };
    }
    return { label: "Prête à archiver", tone: "success", detail: "Décaissement réglé — il ne reste qu'à archiver." };
  }
  return { label: "Sortie en brouillon", tone: "info", detail: "Pas encore soumise." };
}

const TONE_BADGE: Record<RowTone, BadgeProps["variant"]> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  success: "success",
  neutral: "neutral",
};

// Ordre d'urgence : ce qui bloque quelqu'un d'abord, ce qui est prêt à archiver en dernier.
const SORT_RANK: Record<string, number> = {
  rejected: 0,
  submitted: 1,
  draft_out: 2,
  pending_payout: 3,
  draft_in: 4,
  ready_to_archive: 5,
};

function sortRank(item: InProgressInspectionItem): number {
  if (item.kind === "move-in") return SORT_RANK.draft_in;
  if (item.reviewStatus === "rejected") return SORT_RANK.rejected;
  if (item.reviewStatus === "submitted") return SORT_RANK.submitted;
  if (item.status === "finalized") {
    return item.payoutStatus === "pending" ? SORT_RANK.pending_payout : SORT_RANK.ready_to_archive;
  }
  return SORT_RANK.draft_out;
}

function EtatsDesLieuxContent() {
  const { accessToken } = useAuth();
  const canArchiveAction = useCan("comptabilite");
  const { success, error: toastError } = useToast();
  const [items, setItems] = React.useState<InProgressInspectionItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [archivingLeaseId, setArchivingLeaseId] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getInProgressInspections(accessToken)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les états des lieux en cours."));
  }, [accessToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleArchive(item: InProgressInspectionItem) {
    if (!accessToken) return;
    setArchivingLeaseId(item.leaseId);
    try {
      await archiveMoveOutReport(accessToken, item.leaseId);
      success(`${item.renterName} archivé(e)`);
      setItems((prev) => (prev ? prev.filter((i) => !(i.leaseId === item.leaseId && i.kind === "move-out")) : prev));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Impossible d'archiver pour l'instant.");
    } finally {
      setArchivingLeaseId(null);
    }
  }

  const sorted = items ? [...items].sort((a, b) => sortRank(a) - sortRank(b)) : null;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white">
              <Inbox size={18} />
            </span>
            <h1 className="font-display text-headline-xl text-ink">État des lieux</h1>
          </div>
          <p className="text-body-md text-ink-soft">
            Tout état des lieux en cours, entrée et sortie, tombe ici dès son démarrage et y reste jusqu&apos;à sa
            phase terminale — reprenez ceux que vous avez commencés, ou traitez ceux qui attendent une décision.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {sorted === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : sorted && sorted.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 size={28} className="text-success" />
              <p className="font-label-md text-ink">Rien en cours</p>
              <p className="text-body-sm text-ink-muted">Tous les états des lieux sont finalisés et archivés.</p>
            </CardContent>
          </Card>
        ) : sorted ? (
          <div className="flex flex-col gap-3">
            {sorted.map((item) => {
              const info = statusInfo(item);
              const href =
                item.kind === "move-in"
                  ? `/espace/locataires/${item.renterId}/etat-des-lieux?leaseId=${item.leaseId}`
                  : `/espace/locataires/${item.renterId}/sortie?leaseId=${item.leaseId}`;
              return (
                <Card key={`${item.kind}-${item.leaseId}`} className="overflow-hidden">
                  <CardContent className="flex flex-wrap items-center gap-4 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-soft">
                      {item.kind === "move-in" ? <ClipboardList size={18} /> : <Send size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-label-md text-ink">
                          {item.renterName} — {item.unitCode}
                        </p>
                        <Badge variant={TONE_BADGE[info.tone]} dot={info.tone === "danger"}>
                          {info.label}
                        </Badge>
                      </div>
                      <p className="text-body-xs text-ink-muted">
                        {item.kind === "move-in" ? "Entrée" : "Sortie"} démarrée le {formatDateLabel(item.conductedAt)}
                        {" · "}
                        {info.detail}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link href={href}>
                        <Button variant="secondary" size="sm">
                          Ouvrir
                        </Button>
                      </Link>
                      {item.kind === "move-out" && item.canArchive && canArchiveAction && (
                        <Button
                          size="sm"
                          onClick={() => handleArchive(item)}
                          disabled={archivingLeaseId === item.leaseId}
                        >
                          <Archive size={14} />
                          {archivingLeaseId === item.leaseId ? "Archivage…" : "Archivé"}
                        </Button>
                      )}
                      {item.kind === "move-out" && item.payoutStatus === "pending" && (
                        <span className="flex items-center gap-1 text-body-xs text-warning-fg">
                          <AlertTriangle size={14} />
                          Décaissement requis
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
