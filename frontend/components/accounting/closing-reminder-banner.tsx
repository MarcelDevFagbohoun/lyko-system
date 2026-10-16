"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { getClosingOverview, type ClosingOverview } from "@/lib/api/accounting";
import { cn, monthLabelFr } from "@/lib/utils";

/**
 * Rappel de clôture sur l'accueil et le tableau de bord du DG (étape 54) : visible seulement quand il
 * y a quelque chose à faire — le prochain mois est prêt à clôturer, ou des mois s'accumulent sans
 * être clôturés. Un clic mène directement à la page Clôture, déjà positionnée sur le bon mois.
 */
export function ClosingReminderBanner({ accessToken }: { accessToken: string | null }) {
  const [overview, setOverview] = React.useState<ClosingOverview | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getClosingOverview(accessToken)
      .then(setOverview)
      .catch(() => {
        // Rappel facultatif : en cas d'échec, rien n'est affiché (la page Clôture reste accessible).
      });
  }, [accessToken]);

  const next = overview?.next;
  if (!overview || !next || next.isCurrentMonth) return null;

  // Mois terminés mais pas encore clôturés, prochain mois compris.
  const backlog = overview.months.filter((m) => m.status === "pret" || m.status === "en_attente" || m.status === "a_suivre").length;
  if (!next.isClosable && backlog < 2) return null;

  const label = monthLabelFr(next.month);
  const warnings = next.checks.filter((c) => c.status === "attention").length;
  const title = next.isClosable
    ? `${label.charAt(0).toUpperCase()}${label.slice(1)} est prêt à être clôturé`
    : `${backlog} mois terminés ne sont pas encore clôturés`;
  const detail =
    backlog >= 2
      ? `${backlog} mois attendent leur clôture, en commençant par ${label}.`
      : warnings > 0
        ? `${warnings} point${warnings > 1 ? "s" : ""} à vérifier avant de clôturer.`
        : "Toutes les vérifications sont au vert.";

  return (
    <Link
      href="/espace/cloture"
      className={cn(
        "group flex items-center gap-3 rounded-lg border px-4 py-3 transition-shadow hover:shadow-md",
        next.isClosable && backlog < 2 ? "border-success/40 bg-success-bg" : "border-warning-border bg-warning/10",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white",
          next.isClosable && backlog < 2 ? "bg-success" : "bg-warning",
        )}
      >
        <Lock size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-label-md text-ink">{title}</span>
        <span className="text-body-sm text-ink-soft">{detail}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-label-md text-primary">
        Clôturer
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
