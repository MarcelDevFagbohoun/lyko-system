"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  updateMoveOutReport,
  uploadInspectionItemPhoto,
  deleteInspectionItemPhoto,
  finalizeMoveOutReport,
  type Lease,
  type MoveOutReport,
  type InspectionZone,
  type PaymentMethod,
  type AdditionalDepositType,
  type ExitExtraLine,
  type MoveOutStatement,
  getMoveOutReport,
} from "@/lib/api/renters";
import { listCatalogItems, type CatalogItem } from "@/lib/api/inspectionCatalog";
import { compareInspectionReports } from "@/lib/inspection-comparison";
import { formatFcfa } from "@/lib/utils";
import { InspectionForm } from "@/components/inspections/inspection-form";
import { FinalizeSection } from "@/components/inspections/finalize-section";
import {
  BalanceDueSection,
  ExitLinesEditor,
  ExitStatementTable,
  type BalanceChoice,
} from "@/components/inspections/exit-statement";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { BillingReportSection, ComparisonSection } from "./finalized-view";
import { REFUND_PAYMENT_METHODS } from "./shared";

export function DraftEditor({
  leaseId,
  lease,
  report,
  accessToken,
  onReportChange,
  onFinalized,
  renterName,
}: {
  renterName: string;
  leaseId: number;
  lease: Lease;
  report: MoveOutReport;
  accessToken: string | null;
  onReportChange: (report: MoveOutReport) => void;
  onFinalized: () => void;
}) {
  const [zones, setZones] = React.useState<InspectionZone[]>(report.zones);
  const [generalNotes, setGeneralNotes] = React.useState(report.generalNotes ?? "");
  // Lignes libres (main-d'œuvre, pénalités…) ; une ancienne retenue unique devient une ligne « autre ».
  const [extraLines, setExtraLines] = React.useState<ExitExtraLine[]>(
    report.extraLines.length > 0
      ? report.extraLines
      : report.otherDeductionsAmount > 0
        ? [{ kind: "autre", label: report.otherDeductionsNote ?? "Autre retenue", amount: report.otherDeductionsAmount }]
        : [],
  );
  const [statement, setStatement] = React.useState<MoveOutStatement | null>(null);
  const [balance, setBalance] = React.useState<BalanceChoice>({ resolution: "", paymentMethod: "", note: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalizeError, setFinalizeError] = React.useState<string | null>(null);
  const [refundPaymentMethod, setRefundPaymentMethod] = React.useState("");
  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const toast = useToast();

  // Cautions supplémentaires (étape 43) — celles encore détenues sur ce bail (SBEE/SONEB réglées
  // automatiquement à la sortie sur les charges impayées, peinture retenue manuellement ci-dessous).
  const heldAdditionalDeposits = React.useMemo(
    () => lease.additionalDeposits.filter((d) => d.status === "held"),
    [lease.additionalDeposits],
  );
  const peintureDeposit = heldAdditionalDeposits.find((d) => d.type === "peinture");
  const [peintureAmount, setPeintureAmount] = React.useState(
    report.peintureDeductionAmount ? String(report.peintureDeductionAmount) : "",
  );
  const [peintureNote, setPeintureNote] = React.useState(report.peintureDeductionNote ?? "");
  const [additionalDepositRefundMethods, setAdditionalDepositRefundMethods] = React.useState<
    Partial<Record<AdditionalDepositType, string>>
  >({});

  // Dépassement de la retenue peinture au-delà de SA PROPRE caution — reporté sur la caution de LOYER
  // (décision explicite de l'utilisateur, étape 43), calculable côté client car on connaît déjà le
  // montant de la caution peinture (contrairement à SBEE/SONEB, dont le solde impayé réel n'est connu
  // que côté serveur au moment de la sortie).
  const peintureDeduction = peintureDeposit ? Math.min(Number(peintureAmount) || 0, peintureDeposit.amount) : 0;
  const peintureOverflow = peintureDeposit ? Math.max(0, (Number(peintureAmount) || 0) - peintureDeposit.amount) : 0;
  const peintureReturned = peintureDeposit ? peintureDeposit.amount - peintureDeduction : 0;

  React.useEffect(() => {
    if (!accessToken) return;
    getMoveOutReport(accessToken, leaseId).then((res) => setStatement(res.statement)).catch(() => {
      // Le point de sortie reste calculé à l'enregistrement du brouillon.
    });
  }, [accessToken, leaseId]);

  React.useEffect(() => {
    if (!accessToken) return;
    listCatalogItems(accessToken).then((res) => setCatalog(res.items)).catch(() => {
      // Le catalogue est un confort (prix suggérés) — son indisponibilité ne
      // doit jamais bloquer la saisie de l'état des lieux.
    });
  }, [accessToken]);

  // Postes dégradés par rapport à l'entrée ("zoneKey::itemKey") — utilisé
  // pour mettre en évidence l'invite à facturer directement dans le
  // formulaire, sans dépendre du dépliement de la section de comparaison.
  // Pièces et éléments de la fiche d'entrée : non retirables à la sortie (étape 56), sinon leur
  // comparaison entrée/sortie disparaîtrait. Ce qui est ajouté à la sortie reste retirable.
  const lockedKeys = React.useMemo(() => {
    if (!lease.moveInReport) return undefined;
    const keys = new Set<string>();
    for (const zone of lease.moveInReport.zones) {
      keys.add(zone.key);
      for (const item of zone.items) keys.add(`${zone.key}::${item.key}`);
    }
    return keys;
  }, [lease.moveInReport]);

  const degradedKeys = React.useMemo(() => {
    if (!lease.moveInReport) return undefined;
    const results = compareInspectionReports(lease.moveInReport, { ...report, zones });
    return new Set(results.filter((r) => r.status === "degraded").map((r) => `${r.zoneKey}::${r.itemKey}`));
  }, [lease.moveInReport, report, zones]);

  const itemsTotal = zones.reduce((sum, z) => sum + z.items.reduce((s, it) => s + it.deduction, 0), 0);
  const validExtraLines = extraLines.filter((l) => l.label.trim().length >= 2);
  const otherTotal = validExtraLines.reduce((s, l) => s + (l.kind === "realisee_locataire" ? 0 : l.amount), 0);
  const rentOwed = statement?.rent.owed ?? 0;
  // Le dépassement de la retenue peinture (au-delà de SA propre caution) s'ajoute aux retenues de la
  // caution de LOYER — décision explicite de l'utilisateur, même calcul que la route de finalisation.
  const grossDue = itemsTotal + otherTotal + peintureOverflow + rentOwed;
  const netRefund = Math.max(0, report.depositAmount - grossDue);
  const shortfall = Math.max(0, grossDue - report.depositAmount);

  async function persist() {
    if (!accessToken) throw new Error("no token");
    const res = await updateMoveOutReport(accessToken, leaseId, {
      zones,
      generalNotes: generalNotes.trim() || undefined,
      extraLines: validExtraLines,
      peintureDeductionAmount: Number(peintureAmount) || undefined,
      peintureDeductionNote: peintureNote.trim() || undefined,
    });
    onReportChange(res.report);
    setZones(res.report.zones);
    setStatement(res.statement);
    return res.report;
  }

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await persist();
      toast.success("Brouillon enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le brouillon.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadPhoto(zoneKey: string, itemKey: string, file: File) {
    if (!accessToken) return;
    try {
      const res = await uploadInspectionItemPhoto(accessToken, "move-out", leaseId, zoneKey, itemKey, file);
      onReportChange(res.report as MoveOutReport);
      setZones(res.report.zones);
      toast.success("Photo envoyée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer la photo.");
    }
  }

  async function handleDeletePhoto(zoneKey: string, itemKey: string, photoIndex: number) {
    if (!accessToken) return;
    try {
      const res = await deleteInspectionItemPhoto(accessToken, "move-out", leaseId, zoneKey, itemKey, photoIndex);
      onReportChange(res.report as MoveOutReport);
      setZones(res.report.zones);
      toast.info("Photo retirée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer la photo.");
    }
  }

  async function handleFinalize(tenantSignature: Blob | null, agentSignature: Blob | null, tenantReserves: string) {
    if (!accessToken) return;
    if (netRefund > 0 && !refundPaymentMethod) {
      setFinalizeError("Indiquez comment la caution sera restituée avant de finaliser.");
      return;
    }
    // SBEE/SONEB : le solde impayé réel n'est connu que côté serveur (vérifié à nouveau là-bas) — mais
    // la retenue peinture est calculable ici, donc vérifiée avant tout envoi comme la caution ci-dessus.
    if (peintureReturned > 0 && !additionalDepositRefundMethods.peinture) {
      setFinalizeError("Indiquez comment la caution peinture sera restituée avant de finaliser.");
      return;
    }
    if (shortfall > 0) {
      if (!balance.resolution) {
        setFinalizeError("Le locataire doit encore une somme : indiquez s'il règle la différence ou effectue les réparations.");
        return;
      }
      if (balance.resolution === "paid" && !balance.paymentMethod) {
        setFinalizeError("Indiquez comment le locataire règle la différence.");
        return;
      }
    }
    setFinalizing(true);
    setFinalizeError(null);
    try {
      // Comme pour l'entrée : on sauvegarde le brouillon avant de finaliser,
      // pour ne jamais figer une version en retard sur l'écran affiché.
      await persist();
      const res = await finalizeMoveOutReport(
        accessToken,
        leaseId,
        tenantSignature,
        agentSignature,
        netRefund > 0 ? (refundPaymentMethod as PaymentMethod) : undefined,
        additionalDepositRefundMethods as Partial<Record<AdditionalDepositType, PaymentMethod>>,
        tenantReserves || undefined,
        shortfall > 0 && balance.resolution
          ? { resolution: balance.resolution, paymentMethod: balance.paymentMethod || undefined, note: balance.note.trim() || undefined }
          : undefined,
      );
      onReportChange(res.report);
      toast.success("Sortie finalisée — bail terminé, unité libérée.");
      if (res.depositAccountingNote) toast.info(res.depositAccountingNote);
      for (const d of res.additionalDeposits.filter((dep) => dep.status === "returned")) {
        toast.info(
          `${d.typeLabel} : ${d.deductionAmount > 0 ? `${formatFcfa(d.deductionAmount)} retenu, ` : ""}${formatFcfa(d.returnedAmount ?? 0)} à restituer.`,
        );
      }
      onFinalized();
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : "Impossible de finaliser la sortie.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Organiser la sortie — brouillon</CardTitle>
        <CardDescription>
          {lease.unit.designationLabel} ({lease.unit.code}) · état des lieux contradictoire et décompte de caution.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {lease.arrears?.status === "late" && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Loyer en retard de {lease.arrears.daysLate} jour(s) (échéance du {lease.arrears.dueDate}). Vous
              pouvez en tenir compte via « Autres retenues » ci-dessous si vous souhaitez le déduire de la caution.
            </span>
          </div>
        )}

        {lease.moveInReport && <ComparisonSection moveIn={lease.moveInReport} moveOut={{ ...report, zones }} />}

        <InspectionForm
          zones={zones}
          onChange={setZones}
          showDeductions
          catalog={catalog}
          degradedKeys={degradedKeys}
          lockedKeys={lockedKeys}
          onUploadPhoto={handleUploadPhoto}
          onDeletePhoto={handleDeletePhoto}
          accessToken={accessToken}
        />

        <BillingReportSection zones={zones} />

        <ExitLinesEditor lines={extraLines} onChange={setExtraLines} />

        {heldAdditionalDeposits.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Cautions supplémentaires</span>
            {heldAdditionalDeposits.map((d) =>
              d.type === "peinture" ? (
                <div key="peinture" className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label-sm text-ink">{d.typeLabel}</span>
                    <span className="tabular text-body-sm text-ink-muted">{formatFcfa(d.amount)} détenue</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Retenue (FCFA)" htmlFor="peintureAmount" hint="Plafonnée à cette caution — le dépassement s'ajoute à la caution de loyer">
                      <Input
                        id="peintureAmount"
                        inputMode="numeric"
                        value={peintureAmount}
                        onChange={(e) => setPeintureAmount(e.target.value.replace(/\D/g, ""))}
                      />
                    </Field>
                    <Field label="Motif" htmlFor="peintureNote">
                      <Input id="peintureNote" value={peintureNote} onChange={(e) => setPeintureNote(e.target.value)} />
                    </Field>
                  </div>
                  {peintureOverflow > 0 && (
                    <p className="text-body-xs text-warning-fg">
                      Dépassement de {formatFcfa(peintureOverflow)} ajouté aux retenues de la caution de loyer ci-dessus.
                    </p>
                  )}
                  {peintureReturned > 0 && (
                    <Field label="Restituée par" htmlFor="peintureRefundMethod" required>
                      <select
                        id="peintureRefundMethod"
                        value={additionalDepositRefundMethods.peinture ?? ""}
                        onChange={(e) =>
                          setAdditionalDepositRefundMethods((m) => ({ ...m, peinture: e.target.value }))
                        }
                        className="h-[38px] w-full max-w-xs rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="" disabled>
                          Choisir…
                        </option>
                        {REFUND_PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              ) : (
                <div key={d.type} className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label-sm text-ink">{d.typeLabel}</span>
                    <span className="tabular text-body-sm text-ink-muted">{formatFcfa(d.amount)} détenue</span>
                  </div>
                  <p className="text-body-xs text-ink-muted">
                    Réglera automatiquement les charges {d.type === "sbee" ? "SBEE" : "SONEB"} impayées de ce
                    locataire à la finalisation ; le reste, s&apos;il y en a, sera à restituer.
                  </p>
                  <Field label="Restituée par (si un reste)" htmlFor={`refundMethod-${d.type}`}>
                    <select
                      id={`refundMethod-${d.type}`}
                      value={additionalDepositRefundMethods[d.type] ?? ""}
                      onChange={(e) =>
                        setAdditionalDepositRefundMethods((m) => ({ ...m, [d.type]: e.target.value }))
                      }
                      className="h-[38px] w-full max-w-xs rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <option value="">Choisir…</option>
                      {REFUND_PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ),
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="font-label-sm text-ink-soft">Notes générales (optionnel)</label>
          <textarea
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            rows={3}
            className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-label-sm uppercase tracking-wider text-ink-muted">Point de sortie — décompte de la caution</span>
          <ExitStatementTable
            data={{
              depositAmount: report.depositAmount,
              itemsDeductions: itemsTotal,
              extraLines: validExtraLines,
              rentOwed,
              rentMonths: statement?.rent.months ?? [],
              peintureOverflow,
            }}
          />
          {statement?.utilities.some((u) => u.excess > 0) && (
            <p className="text-body-xs text-warning-fg">
              Charges {statement.utilities.filter((u) => u.excess > 0).map((u) => `${u.type === "sbee" ? "SBEE" : "SONEB"} (${formatFcfa(u.excess)} au-delà de la caution dédiée)`).join(", ")} :
              à faire régler directement par le locataire.
            </p>
          )}
        </div>

        {shortfall > 0 && <BalanceDueSection shortfall={shortfall} value={balance} onChange={setBalance} />}

        {netRefund > 0 && (
          <Field label="Caution restituée par" htmlFor="refundPaymentMethod" required hint="Comment ce montant sera remis au locataire">
            <select
              id="refundPaymentMethod"
              value={refundPaymentMethod}
              onChange={(e) => setRefundPaymentMethod(e.target.value)}
              className="h-[38px] w-full max-w-xs rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="" disabled>
                Choisir…
              </option>
              {REFUND_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>
        </div>

        <FinalizeSection printedSignatures onFinalize={handleFinalize} submitting={finalizing} error={finalizeError} tenantName={renterName} />
      </CardContent>
    </Card>
  );
}

