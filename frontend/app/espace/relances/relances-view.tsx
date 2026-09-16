"use client";

import * as React from "react";
import Link from "next/link";
import { MessageCircleWarning, Send, Radar, Droplets, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  listPortfolioArrears,
  listPredictiveAlerts,
  listUtilityArrears,
  type PortfolioArrearsEntry,
  type PredictiveAlertEntry,
  type UtilityArrearsEntry,
} from "@/lib/api/accounting";
import { UTILITY_TYPE_LABELS } from "@/lib/constants/charges";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import {
  formatFcfa,
  formatDateLabel,
  buildRentReminderMessage,
  buildPredictiveReminderMessage,
  buildUtilityReminderMessage,
} from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

/**
 * Centre de relance groupée (étape 10) : tous les locataires en retard sur
 * le portefeuille, en un seul endroit, avec un lien WhatsApp pré-rempli par
 * dossier — toujours manuel (un clic par envoi), pas d'automatisation ni
 * d'API payante. Généralise le bouton « Relancer sur WhatsApp » déjà
 * existant sur la fiche d'un locataire (étape 4).
 */
export function RelancesView() {
  return (
    <RequireAuth permission={["locataires", "comptabilite", "charges"]}>
      <RelancesContent />
    </RequireAuth>
  );
}

function RelancesContent() {
  const { accessToken, tenant } = useAuth();
  const [arrears, setArrears] = React.useState<PortfolioArrearsEntry[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [predictive, setPredictive] = React.useState<PredictiveAlertEntry[] | null>(null);
  const [utilityArrears, setUtilityArrears] = React.useState<UtilityArrearsEntry[] | null>(null);
  const [utilityTotal, setUtilityTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listPortfolioArrears(accessToken)
      .then((res) => {
        setArrears(res.arrears);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les impayés."));
    listPredictiveAlerts(accessToken)
      .then((res) => setPredictive(res.alerts))
      .catch(() => setPredictive([]));
    listUtilityArrears(accessToken)
      .then((res) => {
        setUtilityArrears(res.arrears);
        setUtilityTotal(res.total);
      })
      .catch(() => setUtilityArrears([]));
  }, [accessToken]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Centre de relance</h1>
          <p className="text-body-md text-ink-soft">
            Tous les locataires en retard de loyer, sur l&apos;ensemble du portefeuille.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {arrears && (
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <span className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
                <MessageCircleWarning size={16} className="text-danger-fg" />
                {arrears.length} locataire(s) en retard
              </span>
              <span className="tabular font-currency-table text-headline-sm text-danger-fg">{formatFcfa(total)}</span>
            </CardContent>
          </Card>
        )}

        {arrears === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : arrears && arrears.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-body-sm text-ink-muted">
              Aucun retard de loyer en cours — tout le portefeuille est à jour.
            </CardContent>
          </Card>
        ) : arrears ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Locataire</TableHead>
                <TableHead>Bien / unité</TableHead>
                <TableHead className="text-right">Montant dû</TableHead>
                <TableHead>Retard</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {arrears.map((a) => {
                const message = buildRentReminderMessage({
                  renterFirstName: a.renterName.split(" ")[0] ?? a.renterName,
                  unitLabel: a.unitCode,
                  monthlyRent: a.monthlyRent,
                  daysLate: a.daysLate,
                  dueDate: a.dueDate,
                  companyName: tenant?.companyName,
                });
                return (
                  <TableRow key={a.leaseId}>
                    <TableCell>
                      <Link href={`/espace/locataires/${a.renterId}`} className="text-primary hover:underline">
                        {a.renterName}
                      </Link>
                      <div className="text-body-xs text-ink-muted">{a.phone}</div>
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {a.propertyCode} · {a.unitCode}
                    </TableCell>
                    <TableAmount>{formatFcfa(a.amountOwed)}</TableAmount>
                    <TableCell className="text-danger-fg">
                      {a.daysLate} j · {a.unpaidMonths} mois dû(s)
                    </TableCell>
                    <TableCell className="text-ink-soft">{formatDateLabel(a.dueDate)}</TableCell>
                    <TableCell className="text-right">
                      <a href={buildWhatsAppHref(a.phone, message)} target="_blank" rel="noopener noreferrer" className="inline-flex">
                        <span className={buttonVariants({ variant: "whatsapp", size: "sm" })}>
                          <Send size={14} />
                          Relancer
                        </span>
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {utilityArrears && utilityArrears.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <h2 className="inline-flex items-center gap-2 font-display text-headline-md text-ink">
                <Droplets size={20} className="text-danger-fg" />
                Charges SONEB/SBEE impayées
              </h2>
              <p className="text-body-sm text-ink-soft">
                Factures d&apos;eau et d&apos;électricité en attente de règlement, sur l&apos;ensemble du portefeuille.
              </p>
            </div>
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <span className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
                  <MessageCircleWarning size={16} className="text-danger-fg" />
                  {utilityArrears.length} facture(s) en attente
                </span>
                <span className="tabular font-currency-table text-headline-sm text-danger-fg">{formatFcfa(utilityTotal)}</span>
              </CardContent>
            </Card>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Locataire</TableHead>
                  <TableHead>Bien / unité</TableHead>
                  <TableHead>Fluide</TableHead>
                  <TableHead className="text-right">Montant dû</TableHead>
                  <TableHead>Retard</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {utilityArrears.map((a) => {
                  const message = buildUtilityReminderMessage({
                    renterFirstName: a.renterName.split(" ")[0] ?? a.renterName,
                    unitLabel: a.unitCode,
                    utilityTypeLabel: UTILITY_TYPE_LABELS[a.utilityType],
                    amountOwed: a.amountOwed,
                    daysLate: a.daysLate,
                    billedAt: formatDateLabel(a.billedAt),
                    companyName: tenant?.companyName,
                  });
                  return (
                    <TableRow key={a.chargeId}>
                      <TableCell>
                        <Link href={`/espace/locataires/${a.renterId}`} className="text-primary hover:underline">
                          {a.renterName}
                        </Link>
                        <div className="text-body-xs text-ink-muted">{a.phone}</div>
                      </TableCell>
                      <TableCell className="text-ink-soft">
                        {a.propertyCode} · {a.unitCode}
                      </TableCell>
                      <TableCell className="text-ink-soft">
                        <span className="inline-flex items-center gap-1.5">
                          {a.utilityType === "soneb" ? <Droplets size={14} /> : <Zap size={14} />}
                          {UTILITY_TYPE_LABELS[a.utilityType]}
                        </span>
                      </TableCell>
                      <TableAmount>{formatFcfa(a.amountOwed)}</TableAmount>
                      <TableCell className="text-danger-fg">{a.daysLate} j</TableCell>
                      <TableCell className="text-right">
                        <a href={buildWhatsAppHref(a.phone, message)} target="_blank" rel="noopener noreferrer" className="inline-flex">
                          <span className={buttonVariants({ variant: "whatsapp", size: "sm" })}>
                            <Send size={14} />
                            Relancer
                          </span>
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {predictive && predictive.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <h2 className="inline-flex items-center gap-2 font-display text-headline-md text-ink">
                <Radar size={20} className="text-warning-fg" />
                Alertes prédictives
              </h2>
              <p className="text-body-sm text-ink-soft">
                Locataires à jour pour l&apos;instant, mais habituellement en retard, dont l&apos;échéance approche.
                Relancez-les avant que le retard n&apos;arrive.
              </p>
            </div>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Locataire</TableHead>
                  <TableHead>Bien / unité</TableHead>
                  <TableHead>Historique</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {predictive.map((a) => {
                  const message = buildPredictiveReminderMessage({
                    renterFirstName: a.renterName.split(" ")[0] ?? a.renterName,
                    unitLabel: a.unitCode,
                    monthlyRent: a.monthlyRent,
                    dueDate: formatDateLabel(a.dueDate),
                    companyName: tenant?.companyName,
                  });
                  return (
                    <TableRow key={a.leaseId}>
                      <TableCell>
                        <Link href={`/espace/locataires/${a.renterId}`} className="text-primary hover:underline">
                          {a.renterName}
                        </Link>
                        <div className="text-body-xs text-ink-muted">{a.phone}</div>
                      </TableCell>
                      <TableCell className="text-ink-soft">
                        {a.propertyCode} · {a.unitCode}
                      </TableCell>
                      <TableCell className="text-warning-fg">
                        {a.lateCount}/{a.recentPaymentsCount} derniers paiements en retard
                      </TableCell>
                      <TableCell className="text-ink-soft">
                        {formatDateLabel(a.dueDate)}
                        {a.daysUntilDue >= 0 && ` (dans ${a.daysUntilDue} j)`}
                      </TableCell>
                      <TableCell className="text-right">
                        <a href={buildWhatsAppHref(a.phone, message)} target="_blank" rel="noopener noreferrer" className="inline-flex">
                          <span className={buttonVariants({ variant: "warning", size: "sm" })}>
                            <Send size={14} />
                            Relancer
                          </span>
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
