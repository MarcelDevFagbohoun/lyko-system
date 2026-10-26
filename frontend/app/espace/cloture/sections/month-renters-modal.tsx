"use client";

import * as React from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import { getRentMonthRenters, type RentMonthRenter } from "@/lib/api/accounting";
import { MonthBilanPanel } from "../month-bilan-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatFcfa, monthLabelFr } from "@/lib/utils";

export const STATUS_BADGE: Record<RentMonthRenter["status"], { variant: "success" | "warning" | "danger" | "info" | "neutral"; label: string }> = {
  paye: { variant: "success", label: "Payé" },
  partiel: { variant: "warning", label: "Partiel" },
  en_retard: { variant: "danger", label: "En retard" },
  a_payer: { variant: "info", label: "À payer" },
  a_venir: { variant: "neutral", label: "À venir" },
};

/**
 * Point financier de chaque locataire pour un mois clôturé (demande utilisateur, 2026-10-18) —
 * ouverte en cliquant une ligne de « Historique des clôtures ». Fonctionne par construction pour
 * n'importe quel mois (voir `listRentMonthRenters`, backend) : un mois déjà clôturé ne reçoit plus
 * aucun paiement rétroactif, le résultat y est donc déjà figé de fait.
 */
export function MonthRentersModal({
  month,
  accessToken,
  onClose,
}: {
  month: string;
  accessToken: string | null;
  onClose: () => void;
}) {
  const [renters, setRenters] = React.useState<RentMonthRenter[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    setRenters(null);
    setError(null);
    getRentMonthRenters(accessToken, month)
      .then((rentersRes) => setRenters(rentersRes.renters))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le détail de ce mois."));
  }, [accessToken, month]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-renters-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="month-renters-title" className="font-display text-headline-sm capitalize text-ink">
            Bilan — {monthLabelFr(month)}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <MonthBilanPanel month={month} accessToken={accessToken} />

        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Loyer de ce mois, locataire par locataire</p>
        {renters === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : renters && renters.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun locataire suivi sur ce mois.</p>
        ) : renters ? (
          <div className="overflow-y-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-body-xs uppercase tracking-wider text-ink-muted">
                  <th className="py-2 pr-2 font-label-sm">Locataire</th>
                  <th className="py-2 pr-2 font-label-sm">Bien</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Loyer</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Payé</th>
                  <th className="py-2 pr-2 text-right font-label-sm">Reste</th>
                  <th className="py-2 text-center font-label-sm">Statut</th>
                </tr>
              </thead>
              <tbody>
                {renters.map((r) => {
                  const badge = STATUS_BADGE[r.status];
                  return (
                    <tr key={r.leaseId} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 pr-2">
                        <Link
                          href={`/espace/locataires/${r.renterId}`}
                          className="font-label-sm text-primary hover:underline"
                        >
                          {r.renterName}
                        </Link>
                      </td>
                      <td className="py-2 pr-2 text-ink-soft">
                        <div>{r.unitLabel}</div>
                        <div className="text-body-xs text-ink-muted">{r.propertyLabel}</div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.monthlyRent)}</td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.paid)}</td>
                      <td className="py-2 pr-2 text-right tabular text-ink">{formatFcfa(r.remaining)}</td>
                      <td className="py-2 text-center">
                        <Badge variant={badge.variant} dot>
                          {badge.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Explication (point 6) : ouverte à la toute première visite, repliée ensuite ─────────────────

