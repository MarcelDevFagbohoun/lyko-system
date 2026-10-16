"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock, StickyNote } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  getMonthlyArchive,
  type MonthlyArchiveRenterEntry,
  type MonthlyArchiveRent,
} from "@/lib/api/accounting";
import { UTILITY_TYPE_LABELS, CHARGE_STATUS_LABELS } from "@/lib/constants/charges";
import { formatFcfa, formatDateLabel, monthLabelFr } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const RENT_STATUS_LABEL: Record<MonthlyArchiveRent["status"], string> = {
  paye: "Payé",
  partiel: "Partiel",
  en_retard: "En retard",
  a_payer: "À payer",
  a_venir: "À venir",
  avant_suivi: "Avant le suivi",
  hors_bail: "Hors bail",
};

const RENT_STATUS_VARIANT: Record<MonthlyArchiveRent["status"], BadgeProps["variant"]> = {
  paye: "success",
  partiel: "warning",
  en_retard: "danger",
  a_payer: "info",
  a_venir: "neutral",
  avant_suivi: "neutral",
  hors_bail: "neutral",
};

const CHARGE_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  payee: "success",
  partiellement_payee: "warning",
  impayee: "danger",
};

const LATE_FEE_STATUS_LABEL: Record<string, string> = {
  payee: "Payée",
  partielle: "Partielle",
  impayee: "Impayée",
};

const LATE_FEE_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  payee: "success",
  partielle: "warning",
  impayee: "danger",
};

export function ArchiveMensuelleView() {
  return (
    <RequireAuth permission="comptabilite">
      <ArchiveMensuelleContent />
    </RequireAuth>
  );
}

function ArchiveMensuelleContent() {
  const { accessToken } = useAuth();
  const { period } = useParams<{ period: string }>();

  const [renters, setRenters] = React.useState<MonthlyArchiveRenterEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !period) return;
    setError(null);
    setRenters(null);
    getMonthlyArchive(accessToken, period)
      .then((res) => setRenters(res.renters))
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? "Ce mois n'est pas encore clôturé — aucune archive n'existe."
            : "Impossible de charger l'archive de ce mois.",
        );
      });
  }, [accessToken, period]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col gap-2">
          <Link href="/espace/cloture" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
            <ArrowLeft size={16} />
            Retour à la clôture des mois
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="font-headline-md text-ink">Archive du mois — {monthLabelFr(period)}</h1>
            <Badge variant="neutral">
              <Lock size={12} />
              Lecture seule
            </Badge>
          </div>
          <p className="text-body-sm text-ink-soft">
            Le point de chaque locataire tel qu&apos;il était à la clôture de ce mois : loyer, charges SONEB/SBEE, pénalités de
            retard et note. Ces données sont figées et ne peuvent plus être modifiées.
          </p>
        </div>

        {error && (
          <Card>
            <CardContent className="py-4 text-body-sm text-danger-fg">{error}</CardContent>
          </Card>
        )}

        {!error && renters && renters.length === 0 && (
          <Card>
            <CardContent className="py-4 text-body-sm text-ink-soft">
              Aucun bail n&apos;était concerné par ce mois.
            </CardContent>
          </Card>
        )}

        {!error &&
          renters &&
          renters.map((entry) => <RenterArchiveCard key={entry.leaseId} entry={entry} />)}
      </div>
    </div>
  );
}

function RenterArchiveCard({ entry }: { entry: MonthlyArchiveRenterEntry }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.renterName}</CardTitle>
        <CardDescription>
          {entry.propertyCode} — {entry.unitCode} · {entry.phone}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="font-label-sm uppercase tracking-wider text-ink-muted">Loyer</span>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
            <Badge variant={RENT_STATUS_VARIANT[entry.rent.status]}>{RENT_STATUS_LABEL[entry.rent.status]}</Badge>
            <span className="text-body-sm text-ink">
              {formatFcfa(entry.rent.paid)} payés sur {formatFcfa(entry.rent.due)}
              {entry.rent.remaining > 0 && ` — reste ${formatFcfa(entry.rent.remaining)}`}
            </span>
            <span className="text-body-xs text-ink-muted">Échéance le {formatDateLabel(entry.rent.dueDate)}</span>
          </div>
        </div>

        {entry.charges.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Charges SONEB / SBEE</span>
            <div className="flex flex-col gap-2">
              {entry.charges.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <Badge variant={CHARGE_STATUS_VARIANT[c.status]}>{CHARGE_STATUS_LABELS[c.status]}</Badge>
                  <span className="text-body-sm text-ink">
                    {UTILITY_TYPE_LABELS[c.utilityType]} — {formatFcfa(c.amount)}
                    {c.paid > 0 && c.paid < c.amount && ` (${formatFcfa(c.paid)} réglés)`}
                  </span>
                  <span className="text-body-xs text-ink-muted">Facturée le {formatDateLabel(c.billedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {entry.lateFees.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Pénalités de retard</span>
            <div className="flex flex-col gap-2">
              {entry.lateFees.map((lf) => (
                <div key={lf.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <Badge variant={LATE_FEE_STATUS_VARIANT[lf.status]}>{LATE_FEE_STATUS_LABEL[lf.status]}</Badge>
                  <span className="text-body-sm text-ink">
                    {formatFcfa(lf.amount)}
                    {lf.paid > 0 && lf.paid < lf.amount && ` (${formatFcfa(lf.paid)} réglés)`}
                  </span>
                  <span className="text-body-xs text-ink-muted">Appliquée le {formatDateLabel(lf.appliedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {entry.notesSnapshot && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Note de ce mois</span>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm text-ink-soft">
              <StickyNote size={16} className="mt-0.5 shrink-0 text-ink-muted" />
              <span className="whitespace-pre-wrap">{entry.notesSnapshot}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
