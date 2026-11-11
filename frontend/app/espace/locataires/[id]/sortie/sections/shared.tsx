"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp, Circle, RotateCcw } from "lucide-react";
import type { MoveOutReport, ReviewHistoryEntry } from "@/lib/api/renters";
import { cn, formatFcfa } from "@/lib/utils";

export const REFUND_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

const HISTORY_LABELS: Record<ReviewHistoryEntry["type"], string> = {
  submitted: "Soumis pour validation",
  edited: "Modifié après soumission",
  rejected: "Rejeté",
  validated: "Validé",
  tenant_paid: "Caution restituée au locataire",
  balance_collected: "Complément encaissé du locataire",
  repair_fee_charged: "Frais de réparation prélevés",
};

/**
 * Historique visible du circuit de validation/décaissement (demande utilisateur, 2026-11-03) — journal
 * en ajout seul (`reviewHistory`), partagé entre le brouillon (soumission/rejet/validation) et la fiche
 * finalisée (décaissement/encaissement/frais de réparation, qui arrivent après coup).
 */
export function ReviewHistoryList({ history }: { history: ReviewHistoryEntry[] }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">Historique de validation</span>
      <ul className="flex flex-col gap-1.5">
        {history
          .slice()
          .reverse()
          .map((h, i) => (
            <li key={i} className="text-body-xs text-ink-muted">
              <span className="font-label-sm text-ink">{HISTORY_LABELS[h.type] ?? h.type}</span>
              {h.by?.name ? ` — ${h.by.name}` : ""} · {new Date(h.at).toLocaleString("fr-FR")}
              {h.note ? ` : « ${h.note} »` : ""}
              {h.amount ? ` (${formatFcfa(h.amount)})` : ""}
              {h.changedFields && h.changedFields.length > 0 ? ` (${h.changedFields.join(", ")})` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}

type StepState = "done" | "current" | "upcoming" | "rejected";

/**
 * Frise de progression de la sortie (demande utilisateur, 2026-11-11 — simplifier l'expérience
 * utilisateur) : la finalisation n'est pas la fin du parcours (régularisation comptable, décaissement,
 * archivage suivent, parfois menés par une autre personne un autre jour). Sans repère visuel, rien
 * n'indique ce qui reste à faire — cette frise rend le pipeline entier visible en un coup d'œil, sans
 * toucher à la logique métier (purement dérivée des champs déjà renvoyés par le serveur).
 */
export function MoveOutStepper({ report }: { report: MoveOutReport }) {
  const authorIsDg = report.conductedBy?.role === "dg";
  const isFinalized = report.status === "finalized";
  const hasDeductions = report.totalDeductions > 0;
  const hasPayout = report.payoutStatus !== "not_applicable";

  const steps: { key: string; label: string; state: StepState }[] = [];

  steps.push({
    key: "draft",
    label: "Brouillon",
    state: isFinalized || report.reviewStatus === "submitted" ? "done" : "current",
  });

  if (!authorIsDg) {
    steps.push({
      key: "review",
      label: "Validation DG",
      state: isFinalized
        ? "done"
        : report.reviewStatus === "submitted"
          ? "current"
          : report.reviewStatus === "rejected"
            ? "rejected"
            : "upcoming",
    });
  }

  steps.push({
    key: "finalize",
    label: "Finalisation",
    state: isFinalized
      ? "done"
      : (authorIsDg && report.status === "draft") || report.reviewStatus === "submitted"
        ? "current"
        : "upcoming",
  });

  if (hasDeductions) {
    steps.push({
      key: "gl",
      label: "Régularisation comptable",
      state: !isFinalized ? "upcoming" : report.glRegularizedAt ? "done" : "current",
    });
  }

  if (hasPayout) {
    steps.push({
      key: "payout",
      label: report.payoutDirection === "collect_from_tenant" ? "Encaissement" : "Décaissement",
      state: !isFinalized ? "upcoming" : report.payoutStatus === "paid" ? "done" : "current",
    });
  }

  steps.push({
    key: "archive",
    label: "Archivage",
    state: !isFinalized
      ? "upcoming"
      : report.leaseArchivedAt
        ? "done"
        : report.payoutStatus !== "pending"
          ? "current"
          : "upcoming",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      {steps.map((step, i) => (
        <React.Fragment key={step.key}>
          {i > 0 && <span className="mx-1 h-px w-4 shrink-0 bg-border-strong sm:w-6" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-body-xs font-label-sm",
              step.state === "done" && "bg-success-bg text-success-fg",
              step.state === "current" && "bg-primary text-primary-fg",
              step.state === "upcoming" && "bg-surface text-ink-faint",
              step.state === "rejected" && "bg-danger-bg text-danger-fg",
            )}
          >
            {step.state === "done" && <Check size={12} />}
            {step.state === "current" && <Circle size={8} className="fill-current" />}
            {step.state === "rejected" && <RotateCcw size={12} />}
            {step.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Section repliable pour les cas financiers annexes (peinture, SBEE/SONEB, autres retenues) — demande
 * utilisateur, 2026-11-11 : repliée par défaut tant que l'état des lieux proprement dit n'a pas commencé,
 * pour alléger l'écran, mais toujours ouvrable manuellement et jamais masquée si elle contient déjà
 * une saisie (pour ne jamais cacher une information déjà renseignée).
 */
export function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">{title}</span>
        {open ? <ChevronUp size={16} className="text-ink-muted" /> : <ChevronDown size={16} className="text-ink-muted" />}
      </button>
      {open && children}
    </div>
  );
}

