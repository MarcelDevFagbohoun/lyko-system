"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, FileDown } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getUtilityPoint,
  utilityCarnetPdfPath,
  type BatchPoint,
  type ChargeAccount,
  type OwnerCarnet,
  type PointStatus,
  type PointTotals,
  type UtilityPoint,
} from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS } from "@/lib/constants/charges";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_BADGE: Record<PointStatus, { label: string; variant: "neutral" | "warning" | "danger" | "success" }> = {
  paiement_non_renseigne: { label: "Paiement à déclarer", variant: "neutral" },
  a_recouvrer: { label: "À recouvrer", variant: "warning" },
  a_charge_proprietaire: { label: "À charge du propriétaire", variant: "danger" },
  solde: { label: "Soldé", variant: "success" },
};

const METHOD_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
  kkiapay: "En ligne",
};

function monthOffset(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Le point des charges (étape 30) + le carnet (étape 31) : pour chaque relevé
 * SONEB/SBEE validé, ce que le propriétaire a payé à la facture mère face à ce
 * que le cabinet a réellement encaissé chez les locataires — et, sur la fiche
 * d'un propriétaire (`ownerId`), le carnet complet : chaque règlement reçu,
 * chaque reversement, le solde à reverser et le PDF.
 */
export function UtilityPointPanel({ ownerId }: { ownerId?: number }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [to, setTo] = React.useState(currentMonth);
  const [from, setFrom] = React.useState(() => monthOffset(currentMonth(), -5));
  const [data, setData] = React.useState<UtilityPoint | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !from || !to || from > to) return;
    let cancelled = false;
    setError(null);
    getUtilityPoint(accessToken, { ownerId, from, to })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Chargement du point impossible.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, ownerId, from, to]);

  const invalidRange = !!from && !!to && from > to;

  async function openPdf(forOwnerId: number) {
    if (!accessToken) return;
    try {
      await openAuthenticatedPdf(utilityCarnetPdfPath(forOwnerId, from, to), accessToken);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de générer le carnet en PDF.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-label-sm text-ink-muted">
          Du mois
          <input
            type="month"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-border-strong bg-surface px-2 py-1.5 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-label-sm text-ink-muted">
          Au mois
          <input
            type="month"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-border-strong bg-surface px-2 py-1.5 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <p className="pb-2 text-body-xs text-ink-muted">Mois de début du relevé. Seuls les relevés validés comptent.</p>
        {ownerId != null && (
          <Button variant="secondary" size="sm" className="mb-1 ml-auto" onClick={() => openPdf(ownerId)} disabled={invalidRange}>
            <FileDown size={16} />
            Carnet en PDF
          </Button>
        )}
      </div>

      {invalidRange && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
          Le mois de début doit précéder le mois de fin.
        </div>
      )}
      {error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>}
      {!data && !error && !invalidRange && <p className="text-body-sm text-ink-muted">Chargement…</p>}

      {ownerId != null && data?.carnet && <CarnetBlock carnet={data.carnet} />}

      {ownerId == null && data && data.owners.length === 0 && (
        <Card>
          <CardContent className="py-6 text-body-sm text-ink-muted">
            Aucun relevé validé sur cette période. Le point se construit à partir des relevés de compteurs validés
            (Charges → Relevés par immeuble).
          </CardContent>
        </Card>
      )}

      {ownerId == null &&
        data?.owners.map((o) => (
          <Card key={o.ownerId}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{o.ownerName}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {o.account && o.account.balance > 0 && (
                    <Badge variant="info">{formatFcfa(o.account.balance)} à reverser</Badge>
                  )}
                  <Link href={`/espace/proprietaires/${o.ownerId}`} className="text-body-xs text-primary hover:underline">
                    Fiche propriétaire
                  </Link>
                  <Button variant="secondary" size="sm" onClick={() => openPdf(o.ownerId)} disabled={invalidRange}>
                    <FileDown size={14} />
                    Carnet PDF
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-4">
              <PointBody totals={o.totals} batches={o.batches} />
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

/** Carnet complet d'un propriétaire : point par relevé, compte à reverser, entrées, reversements. */
function CarnetBlock({ carnet }: { carnet: OwnerCarnet }) {
  return (
    <div className="flex flex-col gap-6">
      <PointBody totals={carnet.totals} batches={carnet.batches} />

      <section className="flex flex-col gap-2">
        <div>
          <h3 className="font-label-md text-ink">Entrées : charges payées par les locataires</h3>
          <p className="text-body-xs text-ink-muted">
            Chaque règlement reçu, classé par date de règlement, rattaché au mois de la facture.
          </p>
        </div>
        {carnet.entries.items.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune charge encaissée sur cette période.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Date</TableHead>
                  <TableHead>Locataire</TableHead>
                  <TableHead>Bien · Unité</TableHead>
                  <TableHead>Fluide · Période</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {carnet.entries.items.map((e) => (
                  <TableRow key={e.paymentId}>
                    <TableCell className="tabular text-ink-soft">{e.paidAt}</TableCell>
                    <TableCell>{e.renterName}</TableCell>
                    <TableCell className="text-ink-soft">
                      {e.unitCode.startsWith(e.propertyCode) ? e.unitCode : `${e.propertyCode} · ${e.unitCode}`}
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {UTILITY_TYPE_LABELS[e.utilityType]?.split(" ")[0]} · <span className="capitalize">{monthLabelFr(e.periodStart.slice(0, 7))}</span>
                      {e.batchId == null && <span className="ml-1 text-body-xs text-ink-muted">(individuelle)</span>}
                    </TableCell>
                    <TableCell className="text-ink-soft">{METHOD_LABELS[e.paymentMethod] ?? e.paymentMethod}</TableCell>
                    <TableCell className="text-right tabular font-currency-table">{formatFcfa(e.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-t-border-strong bg-surface-muted">
                  <TableCell colSpan={5} className="font-label-md text-ink">
                    Total encaissé ({carnet.entries.items.length} règlement{carnet.entries.items.length > 1 ? "s" : ""})
                  </TableCell>
                  <TableCell className="text-right tabular font-currency-table">{formatFcfa(carnet.entries.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {carnet.entries.outsideBatchesTotal > 0 && (
              <p className="text-body-xs text-ink-muted">
                Dont {formatFcfa(carnet.entries.outsideBatchesTotal)} de factures individuelles saisies hors relevé de compteurs :
                elles figurent ici mais pas dans le point par relevé ci-dessus.
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-label-md text-ink">Reversements au propriétaire sur la période</h3>
        {carnet.remittances.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun reversement sur cette période.</p>
        ) : (
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
              {carnet.remittances.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular text-ink-soft">{r.paidAt}</TableCell>
                  <TableCell>{r.periodLabel || r.notes || "—"}</TableCell>
                  <TableCell className="text-ink-soft">{METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod}</TableCell>
                  <TableCell className="text-right tabular font-currency-table">{formatFcfa(r.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-t-border-strong bg-surface-muted">
                <TableCell colSpan={3} className="font-label-md text-ink">Total reversé sur la période</TableCell>
                <TableCell className="text-right tabular font-currency-table">{formatFcfa(carnet.remittedInWindow)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** Encaissé / reversé / à reverser — cumul à ce jour, jamais borné à la fenêtre affichée. */
export function AccountLine({ account }: { account: ChargeAccount }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary-border bg-primary-bg/40 p-4">
      <p className="font-label-md text-ink">Compte des charges à reverser (cumul à ce jour)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Charges encaissées" value={formatFcfa(account.collected, { withSuffix: false })} unit="FCFA" tone="default" />
        <StatCard label="Déjà reversées" value={formatFcfa(account.remitted, { withSuffix: false })} unit="FCFA" tone="default" />
        <StatCard label="Reste à reverser" value={formatFcfa(account.balance, { withSuffix: false })} unit="FCFA" tone={account.balance > 0 ? "info" : "success"} />
      </div>
    </div>
  );
}

/** Synthèse chiffrée + tableau « point par relevé ». */
function PointBody({ totals: t, batches }: { totals: PointTotals; batches: BatchPoint[] }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Facture mère payée par le propriétaire" value={formatFcfa(t.mainPaidTotal, { withSuffix: false })} unit="FCFA" tone="default" />
        <StatCard label="Encaissé chez les locataires" value={formatFcfa(t.collectedTotal, { withSuffix: false })} unit="FCFA" tone="info" />
        <StatCard
          label="Reste à la charge du propriétaire"
          value={formatFcfa(t.gapTotal, { withSuffix: false })}
          unit="FCFA"
          tone={t.gapTotal > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Impayés des locataires"
          value={formatFcfa(t.tenantUnpaidTotal, { withSuffix: false })}
          unit="FCFA"
          tone={t.tenantUnpaidTotal > 0 ? "warning" : "success"}
        />
      </div>

      {t.mainPaidTotal > 0 && t.gapTotal !== 0 && (
        <p className="text-body-sm text-ink-soft">
          Le reste de {formatFcfa(t.gapTotal)} se décompose en{" "}
          <strong className="text-ink">{formatFcfa(t.nonRebilledTotal)}</strong> de consommation non refacturée
          (parties communes, logements vacants, pertes de ligne) et{" "}
          <strong className="text-ink">{formatFcfa(t.tenantUnpaidOnPaidTotal)}</strong> d&apos;impayés des
          locataires, encore récupérables.
        </p>
      )}

      {t.pendingPaymentCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {t.pendingPaymentCount} facture{t.pendingPaymentCount > 1 ? "s" : ""} mère{t.pendingPaymentCount > 1 ? "s" : ""} (
            {formatFcfa(t.pendingInvoiceAmount)}) pas encore déclarée{t.pendingPaymentCount > 1 ? "s" : ""} payée
            {t.pendingPaymentCount > 1 ? "s" : ""} : elle{t.pendingPaymentCount > 1 ? "s" : ""} ne pèse
            {t.pendingPaymentCount > 1 ? "nt" : ""} pas dans le reste ci-dessus. Déclarez le paiement depuis le relevé.
          </span>
        </div>
      )}

      {batches.length > 0 && (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Relevé</TableHead>
              <TableHead className="text-right">Facture mère</TableHead>
              <TableHead className="text-right">Facturé</TableHead>
              <TableHead className="text-right">Encaissé</TableHead>
              <TableHead className="text-right">Impayés</TableHead>
              <TableHead className="text-right">Non refacturé</TableHead>
              <TableHead className="text-right">Reste</TableHead>
              <TableHead>Statut</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <BatchPointRow key={b.batchId} b={b} />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function BatchPointRow({ b }: { b: BatchPoint }) {
  const status = STATUS_BADGE[b.status];
  return (
    <TableRow>
      <TableCell>
        <Link href={`/espace/charges/releve/${b.batchId}`} className="font-label-md text-primary hover:underline">
          {b.propertyCode} · {UTILITY_TYPE_LABELS[b.utilityType]}
        </Link>
        <span className="block text-body-xs text-ink-muted capitalize">{monthLabelFr(b.periodStart.slice(0, 7))}</span>
      </TableCell>
      <TableCell className="text-right tabular font-currency-table">
        {b.mainPaid != null ? formatFcfa(b.mainPaid) : b.mainInvoice != null ? <span className="text-ink-muted">{formatFcfa(b.mainInvoice)} (non payée)</span> : "—"}
        {b.mainPaidAt && <span className="block text-body-xs text-ink-muted">payée le {b.mainPaidAt}</span>}
      </TableCell>
      <TableCell className="text-right tabular font-currency-table">{formatFcfa(b.billed)}</TableCell>
      <TableCell className="text-right tabular font-currency-table">{formatFcfa(b.collected)}</TableCell>
      <TableCell className="text-right tabular font-currency-table">{b.tenantUnpaid > 0 ? formatFcfa(b.tenantUnpaid) : "—"}</TableCell>
      <TableCell className="text-right tabular font-currency-table">{b.nonRebilled != null ? formatFcfa(b.nonRebilled) : "—"}</TableCell>
      <TableCell className="text-right tabular font-currency-table">{b.gap != null ? formatFcfa(b.gap) : "—"}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
    </TableRow>
  );
}
