"use client";

import * as React from "react";
import { FileDown, Droplets, AlertTriangle } from "lucide-react";
import type { OwnerCarnet, PointStatus } from "@/lib/api/charges";
import { ownerPortalCarnetPdfUrl } from "@/lib/api/ownerPortal";
import { UTILITY_TYPE_LABELS } from "@/lib/constants/charges";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const METHOD_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
};

// Formulations tournées vers le propriétaire (le cabinet, lui, parle de « reste à la charge du propriétaire »).
const STATUS_TEXT: Record<PointStatus, { label: string; variant: "neutral" | "warning" | "danger" | "success" }> = {
  paiement_non_renseigne: { label: "Paiement non enregistré", variant: "neutral" },
  a_recouvrer: { label: "Locataires à relancer", variant: "warning" },
  a_charge_proprietaire: { label: "À votre charge", variant: "danger" },
  solde: { label: "Soldé", variant: "success" },
};

/**
 * Carnet des charges SONEB/SBEE côté portail propriétaire (étape 31) : ce
 * qu'il a payé à la SONEB/SBEE face à ce qui a été encaissé chez ses
 * locataires, ce qui lui a été reversé, et ce qui lui reste à recevoir.
 * Lecture seule ; le PDF est plafonné à 5 téléchargements (comme le relevé).
 */
export function OwnerPortalCharges({ token, charges }: { token: string; charges: OwnerCarnet }) {
  const t = charges.totals;
  const acc = charges.account;
  const hasData = charges.batches.length > 0 || (acc?.collected ?? 0) > 0 || charges.remittances.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Droplets size={16} className="text-primary" />
          <CardTitle>Charges SONEB / SBEE</CardTitle>
        </div>
        <CardDescription>
          Ce que vous avez payé à la SONEB/SBEE face à ce qui a été encaissé chez vos locataires — les 6 mois jusqu&apos;à{" "}
          {monthLabelFr(charges.to)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasData ? (
          <p className="text-body-sm text-ink-muted">Aucune charge SONEB/SBEE suivie sur cette période pour l&apos;instant.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Factures payées à la SONEB/SBEE" value={formatFcfa(t.mainPaidTotal, { withSuffix: false })} unit="FCFA" />
              <StatCard label="Encaissé chez vos locataires" value={formatFcfa(t.collectedTotal, { withSuffix: false })} unit="FCFA" tone="info" />
              <StatCard label="Reste à votre charge" value={formatFcfa(t.gapTotal, { withSuffix: false })} unit="FCFA" tone={t.gapTotal > 0 ? "danger" : "success"} />
              {acc && <StatCard label="Reste à vous reverser" value={formatFcfa(acc.balance, { withSuffix: false })} unit="FCFA" tone={acc.balance > 0 ? "warning" : "success"} />}
            </div>

            {t.mainPaidTotal > 0 && t.gapTotal > 0 && (
              <p className="text-body-sm text-ink-soft">
                Sur les {formatFcfa(t.gapTotal)} restant à votre charge : {formatFcfa(t.nonRebilledTotal)} de consommation non
                refacturée (parties communes, logements vacants, pertes de ligne) et {formatFcfa(t.tenantUnpaidOnPaidTotal)} de
                charges pas encore réglées par vos locataires.
              </p>
            )}

            {t.pendingPaymentCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning/10 px-3 py-2.5 text-body-sm text-warning-fg">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {t.pendingPaymentCount} facture{t.pendingPaymentCount > 1 ? "s" : ""} de la SONEB/SBEE ({formatFcfa(t.pendingInvoiceAmount)})
                  n&apos;{t.pendingPaymentCount > 1 ? "ont" : "a"} pas encore été enregistrée{t.pendingPaymentCount > 1 ? "s" : ""} comme
                  payée{t.pendingPaymentCount > 1 ? "s" : ""} par votre agence : elle{t.pendingPaymentCount > 1 ? "s ne sont" : " n'est"} pas
                  comptée{t.pendingPaymentCount > 1 ? "s" : ""} ci-dessus.
                </span>
              </div>
            )}

            {charges.batches.length > 0 && (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Relevé</TableHead>
                    <TableHead className="text-right">Facture payée</TableHead>
                    <TableHead className="text-right">Encaissé</TableHead>
                    <TableHead className="text-right">Reste à votre charge</TableHead>
                    <TableHead>Situation</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {charges.batches.map((b) => {
                    const st = STATUS_TEXT[b.status];
                    return (
                      <TableRow key={b.batchId}>
                        <TableCell>
                          <span className="font-label-md text-ink">
                            {b.propertyCode} · {UTILITY_TYPE_LABELS[b.utilityType]?.split(" ")[0]}
                          </span>
                          <span className="block text-body-xs text-ink-muted capitalize">{monthLabelFr(b.periodStart.slice(0, 7))}</span>
                        </TableCell>
                        <TableCell className="text-right tabular font-currency-table">
                          {b.mainPaid != null ? formatFcfa(b.mainPaid) : <span className="text-ink-muted">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular font-currency-table">{formatFcfa(b.collected)}</TableCell>
                        <TableCell className="text-right tabular font-currency-table">{b.gap != null ? formatFcfa(b.gap) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {charges.remittances.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Charges reversées par votre agence</span>
                <Table>
                  <TableHeader>
                    <tr>
                      <TableHead>Date</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {charges.remittances.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular text-ink-soft">{r.paidAt}</TableCell>
                        <TableCell>{r.periodLabel || "Charges SONEB/SBEE"}</TableCell>
                        <TableCell className="text-ink-soft">{METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod}</TableCell>
                        <TableCell className="text-right tabular font-currency-table">{formatFcfa(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => window.open(ownerPortalCarnetPdfUrl(token, charges.from, charges.to), "_blank", "noopener,noreferrer")}
            >
              <FileDown size={16} />
              Télécharger mon carnet des charges
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
