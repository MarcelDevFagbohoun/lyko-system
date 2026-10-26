"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { type AccountingDashboard, type ClosingCheck } from "@/lib/api/accounting";
import { formatDateLabel, formatFcfa } from "@/lib/utils";


export function CheckRow({ check }: { check: ClosingCheck }) {
  const icon =
    check.status === "ok" ? (
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
    ) : check.status === "bloquant" ? (
      <Clock size={18} className="mt-0.5 shrink-0 text-warning" />
    ) : (
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
    );

  let content: React.ReactNode;
  switch (check.key) {
    case "echeances":
      content =
        check.status === "ok" ? (
          <p>Toutes les échéances de loyer du mois sont passées.</p>
        ) : (
          <div>
            <p>
              Des échéances de loyer ne sont pas encore passées : clôture sûre à partir du {formatDateLabel(check.closableFrom)}.
            </p>
            {check.pendingLeases.length > 0 && (
              <ul className="mt-1 text-body-xs text-ink-muted">
                {check.pendingLeases.map((l) => (
                  <li key={l.leaseId}>
                    {l.renterName} ({l.unitCode}), échéance le {l.dueDay}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      break;
    case "loyers":
      content =
        check.status === "ok" ? (
          <p>
            {check.expected > 0
              ? `Tous les loyers du mois sont encaissés (${formatFcfa(check.collected)}).`
              : "Aucun loyer attendu ce mois-ci."}
          </p>
        ) : (
          <p>
            {check.unpaidLeases} loyer{check.unpaidLeases > 1 ? "s" : ""} pas entièrement payé{check.unpaidLeases > 1 ? "s" : ""} :{" "}
            <strong className="text-ink">{formatFcfa(check.remaining)}</strong> restent à encaisser sur{" "}
            {formatFcfa(check.expected)}.{" "}
            <Link href="/espace/relances" className="text-primary underline-offset-2 hover:underline">
              Voir les relances
            </Link>
          </p>
        );
      break;
    case "releves":
      content =
        check.status === "ok" ? (
          <p>Aucun relevé SONEB/SBEE en brouillon sur ce mois.</p>
        ) : (
          <div>
            <p>
              {check.batches.length} relevé{check.batches.length > 1 ? "s" : ""} SONEB/SBEE encore en brouillon : validez-le
              {check.batches.length > 1 ? "s" : ""} pour facturer les locataires.
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-body-xs">
              {check.batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/espace/charges/releve/${b.id}`} className="text-primary underline-offset-2 hover:underline">
                    {b.utilityType.toUpperCase()} — {b.propertyCode} (du {formatDateLabel(b.periodStart)} au{" "}
                    {formatDateLabel(b.periodEnd)})
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      break;
    default:
      content =
        check.status === "ok" ? (
          <p>Toutes les dépenses du mois ont leur justificatif.</p>
        ) : (
          <p>
            {check.count} dépense{check.count > 1 ? "s" : ""} sans justificatif ({formatFcfa(check.total)}) : joignez les reçus
            avant de clôturer.{" "}
            <Link href="/espace/comptabilite#depenses" className="text-primary underline-offset-2 hover:underline">
              Voir les dépenses
            </Link>
          </p>
        );
  }

  return (
    <li className="flex gap-2.5 rounded-lg border border-border px-3 py-2.5 text-body-sm text-ink-soft">
      {icon}
      {content}
    </li>
  );
}

/** Récapitulatif des montants du mois (point 4) — mêmes totaux que le tableau de bord comptable. */
export function MonthRecap({ dashboard }: { dashboard: AccountingDashboard }) {
  const t = dashboard.totals;
  const items = [
    { label: "Loyers encaissés", value: t.rentCollected },
    { label: "Frais d'agence", value: t.entryFeesCollected },
    { label: "Dépenses", value: t.expenses },
    { label: "Reversés aux propriétaires", value: t.ownerPayouts },
    // Charges SONEB/SBEE impayées (demande utilisateur, 2026-10-18 : « une clôture nous devons
    // avoir ... les charges »), cumulées (pas bornées au mois, comme ailleurs sur ce total).
    { label: "Charges SONEB/SBEE impayées", value: t.unpaidCharges },
    { label: "Trésorerie réelle du mois", value: t.treasuryNet ?? t.netCashFlow },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="font-label-sm uppercase tracking-wider text-ink-muted">Ce que vous allez figer</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-surface-muted px-3 py-2">
            <p className="text-body-xs text-ink-muted">{it.label}</p>
            <p className="font-label-md tabular text-ink">{formatFcfa(it.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
