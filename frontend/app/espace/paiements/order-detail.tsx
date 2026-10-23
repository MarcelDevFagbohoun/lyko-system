"use client";

import * as React from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  PAYMENT_STATUS_LABELS,
  getPaymentOrder,
  paymentAdvicePdfPath,
  refreshPaymentOrder,
  retryApplyPaymentOrder,
  type PaymentOrder,
  type PaymentStatus,
  type PaymentTimelineEvent,
} from "@/lib/api/payments";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const EVENT_LABELS: Record<string, string> = {
  order_created: "Ordre créé",
  reauth_failed: "Mot de passe refusé",
  provider_created: "Transmis au prestataire",
  provider_started: "Envoi lancé",
  provider_error: "Erreur du prestataire",
  provider_confirmed: "Envoi confirmé par le prestataire",
  provider_failed: "Échec signalé par le prestataire",
  anomaly_amount: "Anomalie : montant divergent",
  applied: "Enregistré en comptabilité",
  apply_blocked: "À régulariser manuellement",
};

function statusVariant(s: PaymentStatus): "success" | "warning" | "danger" | "neutral" {
  return s === "sent" ? "success" : s === "failed" ? "danger" : s === "processing" ? "warning" : "neutral";
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Détail d'un ordre FedaPay : statut relu chez le prestataire, journal d'événements, avis de paiement. */
export function OrderDetail({
  id,
  accessToken,
  isDg,
  onClose,
  onChanged,
}: {
  id: number;
  accessToken: string | null;
  isDg: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<{ order: PaymentOrder; timeline: PaymentTimelineEvent[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getPaymentOrder(accessToken, id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger ce paiement."));
  }, [accessToken, id]);
  React.useEffect(() => load(), [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }

  const o = data?.order;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Paiement {o?.reference ?? ""}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>}
        {!o ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
              <div><dt className="text-ink-muted">Bénéficiaire</dt><dd className="text-ink">{o.beneficiaryName} — {o.beneficiaryPhoneMasked} ({o.operator.toUpperCase()})</dd></div>
              <div><dt className="text-ink-muted">Montant</dt><dd className="text-ink">{formatFcfa(o.amount)}</dd></div>
              <div><dt className="text-ink-muted">Motif</dt><dd className="text-ink">{o.label}</dd></div>
              <div><dt className="text-ink-muted">Statut</dt><dd><Badge variant={statusVariant(o.status)}>{PAYMENT_STATUS_LABELS[o.status]}</Badge></dd></div>
            </dl>
            {o.failureReason && (
              <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-sm text-warning-fg">{o.failureReason}</p>
            )}
            <ol className="flex flex-col gap-1.5 border-l border-border pl-4 text-body-sm">
              {data.timeline.map((ev) => (
                <li key={ev.id}>
                  <span className="text-ink">{EVENT_LABELS[ev.event] ?? ev.event}</span>{" "}
                  <span className="text-ink-muted">· {formatDateTime(ev.at)}</span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {o.status === "processing" && accessToken && (
                <Button variant="secondary" disabled={busy} onClick={() => run(() => refreshPaymentOrder(accessToken, o.id))}>
                  <RefreshCw size={16} /> Actualiser le statut
                </Button>
              )}
              {o.status === "sent" && !o.applied && isDg && accessToken && (
                <Button variant="secondary" disabled={busy} onClick={() => run(() => retryApplyPaymentOrder(accessToken, o.id))}>
                  Réessayer l&apos;enregistrement comptable
                </Button>
              )}
              {o.status === "sent" && accessToken && (
                <Button
                  variant="secondary"
                  onClick={() => openAuthenticatedPdf(paymentAdvicePdfPath(o.id), accessToken).catch((err) => setError(err instanceof ApiError ? err.message : "Téléchargement impossible."))}
                >
                  <FileDown size={16} /> Avis de paiement (PDF)
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
