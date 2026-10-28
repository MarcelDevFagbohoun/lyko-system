"use client";

import * as React from "react";
import Link from "next/link";
import { DoorOpen, LogOut, FileDown } from "lucide-react";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  createLease,
  entryReceiptPdfPath,
  RENT_TIMING_LABELS,
  type Lease,
  type PaymentMethod,
} from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { formatFcfa, formatLateDuration } from "@/lib/utils";
import { PROPERTY_TYPE_LABELS } from "@/lib/constants/properties";
import { useToast } from "@/lib/toast/toast-context";
import { PropertyUnitPicker } from "@/components/properties/property-unit-picker";
import { Attribution } from "@/components/ui/attribution";
import { Badge } from "@/components/ui/badge";
import { RentStrip } from "@/components/renters/rent-strip";
import { RentDueField, buildRentDuePayload, validateRentDue } from "@/components/renters/rent-due-field";
import { useTenantRhythm } from "@/lib/hooks/use-tenant-rhythm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { BalanceSnapshotsSection } from "./balance-snapshots-section";
import { ChargesSection } from "./charges-section";
import { ComplaintsSection } from "./complaints-section";
import { LateFeesSection } from "./late-fees-section";
import { OpeningDebtSection, PAYMENT_METHODS } from "./opening-debt-section";
import { PaymentRegister } from "./payment-register";
import { RelancesSection } from "./relances-section";

/**
 * Affiché quand un locataire n'a plus de bail actif (parti, ou jamais
 * installé après création). Permet de lui attribuer une nouvelle unité —
 * sans ce formulaire, un locataire libéré restait bloqué sans issue.
 */
export function NewLeaseCard({
  renterId,
  accessToken,
  onCreated,
}: {
  renterId: number;
  accessToken: string | null;
  onCreated: () => void;
}) {
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [monthlyRent, setMonthlyRent] = React.useState("");
  const [depositAmount, setDepositAmount] = React.useState("");
  const [depositPaymentMethod, setDepositPaymentMethod] = React.useState("");
  const [depositPaidAt, setDepositPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [rentDueDay, setRentDueDay] = React.useState("5");
  const [startDate, setStartDate] = React.useState(new Date().toISOString().slice(0, 10));
  // Rythme de période de l'entreprise (étape 2b) : même champ d'échéance que la création d'un locataire.
  const { rhythm } = useTenantRhythm(accessToken);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  function handleSelectUnit(unit: Unit) {
    setSelectedUnit(unit);
    if (!monthlyRent) setMonthlyRent(String(unit.monthlyRent));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !selectedUnit) return;
    const rent = Number(monthlyRent);
    const deposit = Number(depositAmount || "0");
    if (!Number.isFinite(rent) || rent <= 0) return setError("Loyer invalide.");
    if (!Number.isFinite(deposit) || deposit < 0) return setError("Caution invalide.");
    if (deposit > 0 && !depositPaymentMethod) return setError("Indiquez comment la caution a été reçue.");
    const rentDueError = validateRentDue(rhythm, rentDueDay);
    if (rentDueError) return setError(`Échéance du loyer : ${rentDueError.toLowerCase()}.`);
    if (!startDate) return setError("Date d'entrée requise.");

    setSubmitting(true);
    setError(null);
    try {
      await createLease(accessToken, renterId, {
        unitId: selectedUnit.id,
        monthlyRent: rent,
        depositAmount: deposit,
        depositPaymentMethod: deposit > 0 ? (depositPaymentMethod as PaymentMethod) : undefined,
        depositPaidAt: deposit > 0 ? depositPaidAt : undefined,
        ...buildRentDuePayload(rhythm, rentDueDay),
        startDate,
      });
      onCreated();
      toast.success("Nouveau bail créé.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce bail.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attribuer une nouvelle unité</CardTitle>
        <CardDescription>
          Ce locataire n&apos;a pas de bail actif. Sélectionnez une unité libre pour démarrer un nouveau bail.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}

          <PropertyUnitPicker accessToken={accessToken} selectedUnit={selectedUnit} onSelect={handleSelectUnit} />
          {selectedUnit && (
            <p className="text-body-xs text-success-fg">
              Unité {selectedUnit.code} sélectionnée — {formatFcfa(selectedUnit.monthlyRent)}/mois.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loyer mensuel (FCFA)" htmlFor="newLeaseRent" required hint="Pré-rempli depuis l'unité, modifiable">
              <Input
                id="newLeaseRent"
                inputMode="numeric"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Caution (FCFA)" htmlFor="newLeaseDeposit" hint="0 si aucune">
              <Input
                id="newLeaseDeposit"
                inputMode="numeric"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          {Number(depositAmount || "0") > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Caution reçue par" htmlFor="newLeaseDepositMethod" required>
                <select
                  id="newLeaseDepositMethod"
                  value={depositPaymentMethod}
                  onChange={(e) => setDepositPaymentMethod(e.target.value)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reçue le" htmlFor="newLeaseDepositPaidAt">
                <Input id="newLeaseDepositPaidAt" type="date" value={depositPaidAt} onChange={(e) => setDepositPaidAt(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RentDueField rhythm={rhythm} value={rentDueDay} onChange={setRentDueDay} />
            <Field label="Date d'entrée" htmlFor="newLeaseStart" required>
              <Input id="newLeaseStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </div>

          <Button type="submit" disabled={submitting || !selectedUnit} className="self-start">
            {submitting ? "Création en cours…" : !selectedUnit ? "Sélectionnez une unité" : "Créer le bail"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function LeaseCard({
  lease,
  renterId,
  renterFirstName,
  renterPhone,
  accessToken,
  canManage,
  canPay,
  canReadDocs,
  isDg,
  onChanged,
}: {
  lease: Lease;
  renterId: number;
  renterFirstName: string;
  renterPhone: string;
  accessToken: string | null;
  isDg: boolean;
  canManage: boolean;
  canPay: boolean;
  // Paiements/quittances : locataires OU comptabilite (plus large que
  // `canManage`, qui ne couvre que locataires).
  canReadDocs: boolean;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            {lease.unit.designationLabel} <span className="text-ink-muted">({lease.unit.code})</span>
          </CardTitle>
          {lease.arrears?.status === "late" ? (
            <Badge variant="danger" dot>
              En retard {formatLateDuration(lease.arrears.monthsLate, lease.arrears.remainderDaysLate, lease.arrears.daysLate)}
            </Badge>
          ) : (
            <Badge variant="success" dot>
              À jour
            </Badge>
          )}
        </div>
        <CardDescription>
          {lease.unit.property.owner.name} · {PROPERTY_TYPE_LABELS[lease.unit.property.type]}
          {lease.unit.property.address ? ` · ${lease.unit.property.address}` : ""}
        </CardDescription>
        <Attribution actor={lease.createdBy} verb="Bail créé par" at={lease.createdAt} className="mt-0.5 block" />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Loyer mensuel" value={formatFcfa(lease.monthlyRent)} />
          <Metric
            label="Caution"
            value={formatFcfa(lease.depositAmount)}
            sub={lease.depositStatus === "held" ? "Conservée" : "Restituée"}
          />
          <Metric label="Entrée dans les lieux" value={lease.startDate} />
          <Metric
            label="Prochaine échéance"
            value={lease.arrears?.dueDate ?? "—"}
            sub={
              lease.arrears
                ? `Payé jusqu'à ${lease.arrears.paidThroughMonth ?? "aucun mois"} · ${RENT_TIMING_LABELS[lease.rentTiming]}`
                : undefined
            }
          />
        </div>

        {lease.rentStrip && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Les 12 mois en un coup d&apos;œil</span>
            <RentStrip months={lease.rentStrip} variant="full" />
          </div>
        )}

        {lease.entryReceiptNumber && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-4">
            <div>
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Reçu d&apos;entrée</span>
              <p className="text-body-sm text-ink">{lease.entryReceiptNumber}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => accessToken && openAuthenticatedPdf(entryReceiptPdfPath(lease.id), accessToken)}
            >
              <FileDown size={16} />
              Télécharger
            </Button>
          </div>
        )}

        {lease.additionalDeposits.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Cautions supplémentaires</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {lease.additionalDeposits.map((d) => (
                <div key={d.type} className="flex flex-col gap-1 rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label-sm text-ink">{d.typeLabel}</span>
                    <Badge variant={d.status === "held" ? "info" : "success"}>
                      {d.status === "held" ? "Conservée" : "Restituée"}
                    </Badge>
                  </div>
                  <span className="text-body-md text-ink">{formatFcfa(d.amount)}</span>
                  {d.status === "returned" && (
                    <span className="text-body-xs text-ink-muted">
                      {d.deductionAmount > 0 ? `${formatFcfa(d.deductionAmount)} retenu` : "Aucune retenue"}
                      {d.returnedAmount ? ` · ${formatFcfa(d.returnedAmount)} restitué` : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(lease.unit.sonebMeterNumber || lease.unit.sbeeMeterNumber) && (
          <div className="flex flex-wrap gap-4 text-body-xs text-ink-muted">
            {lease.unit.sonebMeterNumber && <span>Compteur SONEB : {lease.unit.sonebMeterNumber}</span>}
            {lease.unit.sbeeMeterNumber && <span>Compteur SBEE : {lease.unit.sbeeMeterNumber}</span>}
            {lease.unit.furnished && <Badge variant="info">Meublé</Badge>}
          </div>
        )}

        {canManage && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-body-sm text-ink-soft">
                <DoorOpen size={16} className="text-primary" />
                {lease.moveInReport?.status === "finalized" ? (
                  <span>
                    État des lieux d&apos;entrée réalisé le {lease.moveInReport.conductedAt}
                    {lease.moveInReport.conductedBy && ` par ${lease.moveInReport.conductedBy.name} (${lease.moveInReport.conductedBy.roleLabel})`}
                  </span>
                ) : lease.moveInReport ? (
                  <span className="text-warning-fg">
                    État des lieux d&apos;entrée en brouillon depuis le {lease.moveInReport.conductedAt}
                  </span>
                ) : (
                  <span className="text-ink-muted">État des lieux d&apos;entrée non réalisé</span>
                )}
              </div>
              <Link href={`/espace/locataires/${renterId}/etat-des-lieux?leaseId=${lease.id}`}>
                <Button variant="ghost" size="sm">
                  {lease.moveInReport?.status === "finalized"
                    ? "Voir l'état des lieux"
                    : lease.moveInReport
                      ? "Continuer le brouillon"
                      : "Réaliser l'état des lieux"}
                </Button>
              </Link>
            </div>

            {/* État des lieux de sortie : ne peut être "finalized" tant que le bail est
                actif (finaliser la sortie termine le bail) — seuls "non réalisé" et
                "brouillon" sont possibles ici. Affiché en symétrie avec l'entrée
                ci-dessus, pour que les deux fiches soient visibles côte à côte ; l'action
                elle-même reste le bouton « Locataire quitte le logement » ci-dessous. */}
            <div className="flex items-center gap-2 text-body-sm text-ink-soft">
              <LogOut size={16} className="text-danger-fg" />
              {lease.moveOutReport ? (
                <span className="text-warning-fg">
                  État des lieux de sortie en brouillon depuis le {lease.moveOutReport.conductedAt}
                </span>
              ) : (
                <span className="text-ink-muted">État des lieux de sortie non réalisé</span>
              )}
            </div>
          </div>
        )}

        <ComplaintsSection leaseId={lease.id} renterId={renterId} accessToken={accessToken} />

        <ChargesSection leaseId={lease.id} renterId={renterId} accessToken={accessToken} />

        {canPay && <LateFeesSection leaseId={lease.id} accessToken={accessToken} canManage={canPay} />}

        <RelancesSection leaseId={lease.id} accessToken={accessToken} />

        {canPay && <OpeningDebtSection lease={lease} accessToken={accessToken} onSettled={onChanged} />}

        {canManage && <BalanceSnapshotsSection leaseId={lease.id} accessToken={accessToken} />}

        <PaymentRegister
          lease={lease}
          renterFirstName={renterFirstName}
          renterPhone={renterPhone}
          accessToken={accessToken}
          canManage={canReadDocs}
          canRecord={canPay}
          isDg={isDg}
          onRecorded={onChanged}
        />
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Link href={`/espace/locataires/${renterId}/sortie?leaseId=${lease.id}`}>
            <Button variant="destructive" size="sm">
              <LogOut size={16} />
              {lease.moveOutReport ? "Continuer la sortie" : "Locataire quitte le logement"}
            </Button>
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

export function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="tabular font-currency-table text-ink">{value}</span>
      {sub && <span className="text-body-xs text-ink-muted">{sub}</span>}
    </div>
  );
}

/**
 * Plaintes rattachées à ce bail (étape 7). N'apparaît que pour qui a la
 * permission dédiée `plaintes` — distincte de `locataires`, un agent peut
 * gérer les baux sans avoir accès à ce module (et inversement).
 */
