"use client";

import * as React from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { ApiError, openAuthenticatedPdf, downloadAuthenticatedFile } from "@/lib/api/client";
import {
  getTrialBalance,
  getThirdPartyBalance,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlow,
  financialStatementsPdfPath,
  financialStatementsXlsxPath,
  type IncomeStatement,
  type BalanceSheet,
  type CashFlowStatement,
  type GlFiscalYear,
  type TrialBalanceLine,
  type ThirdPartyType,
  type ThirdPartyBalanceLine,
} from "@/lib/api/gl";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { SELECT_CLASS } from "./shared";

export const THIRD_PARTY_TYPES: { value: ThirdPartyType; label: string }[] = [
  { value: "renter", label: "Locataires" },
  { value: "owner", label: "Propriétaires" },
  { value: "supplier", label: "Fournisseurs" },
  { value: "employee", label: "Employés" },
  { value: "other", label: "Autres" },
];

export function BalanceTab({ accessToken, fiscalYears }: { accessToken: string | null; fiscalYears: GlFiscalYear[] }) {
  const [fiscalYearId, setFiscalYearId] = React.useState<number | null>(
    fiscalYears.find((fy) => fy.status === "ouvert")?.id ?? fiscalYears[0]?.id ?? null,
  );
  const fiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null;
  const [lines, setLines] = React.useState<TrialBalanceLine[] | null>(null);
  const [totals, setTotals] = React.useState({ totalDebit: 0, totalCredit: 0 });
  const [partyType, setPartyType] = React.useState<ThirdPartyType>("renter");
  const [tiers, setTiers] = React.useState<ThirdPartyBalanceLine[] | null>(null);
  const [income, setIncome] = React.useState<IncomeStatement | null>(null);
  const [balanceSheet, setBalanceSheet] = React.useState<BalanceSheet | null>(null);
  const [cashFlow, setCashFlow] = React.useState<CashFlowStatement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<"pdf" | "xlsx" | null>(null);

  React.useEffect(() => {
    if (!accessToken || !fiscalYearId) return;
    getTrialBalance(accessToken, fiscalYearId)
      .then((res) => {
        setLines(res.lines);
        setTotals(res.totals);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la balance."));
  }, [accessToken, fiscalYearId]);

  React.useEffect(() => {
    if (!accessToken) return;
    getThirdPartyBalance(accessToken, partyType).then((res) => setTiers(res.thirdParties));
  }, [accessToken, partyType]);

  React.useEffect(() => {
    if (!accessToken || !fiscalYearId || !fiscalYear) return;
    Promise.all([
      getIncomeStatement(accessToken, fiscalYearId),
      getBalanceSheet(accessToken, fiscalYearId),
      getCashFlow(accessToken, fiscalYear.startDate, fiscalYear.endDate),
    ])
      .then(([i, b, c]) => {
        setIncome(i);
        setBalanceSheet(b);
        setCashFlow(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les états financiers."));
  }, [accessToken, fiscalYearId, fiscalYear]);

  async function handleExport(kind: "pdf" | "xlsx") {
    if (!accessToken || !fiscalYearId || !fiscalYear) return;
    setExporting(kind);
    setError(null);
    try {
      if (kind === "pdf") {
        await openAuthenticatedPdf(financialStatementsPdfPath(fiscalYearId), accessToken);
      } else {
        await downloadAuthenticatedFile(
          financialStatementsXlsxPath(fiscalYearId),
          accessToken,
          `etats-financiers-${fiscalYear.label}.xlsx`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export impossible.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">États financiers SYSCOHADA</h2>
          <div className="flex items-center gap-2">
            <select
              value={fiscalYearId ?? ""}
              onChange={(e) => setFiscalYearId(Number(e.target.value))}
              className={`${SELECT_CLASS} max-w-xs`}
            >
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.label} {fy.status === "cloture" ? "(clôturé)" : ""}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={!fiscalYearId || exporting !== null} onClick={() => handleExport("pdf")}>
              <FileDown size={14} />
              PDF
            </Button>
            <Button variant="secondary" size="sm" disabled={!fiscalYearId || exporting !== null} onClick={() => handleExport("xlsx")}>
              <FileSpreadsheet size={14} />
              Excel
            </Button>
          </div>
        </div>
        <p className="text-body-xs text-ink-muted">
          Situation provisoire calculée depuis les écritures enregistrées — le résultat net est une ligne calculée, pas
          une écriture d&apos;affectation formelle. À faire valider par un expert-comptable avant toute utilisation
          officielle.
        </p>

        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {income && balanceSheet && cashFlow && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Compte de résultat</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                {income.produits.map((p) => (
                  <div key={p.code} className="flex justify-between">
                    <span className="text-ink-soft">{p.code} — {p.label}</span>
                    <span className="tabular">{formatFcfa(p.amount)}</span>
                  </div>
                ))}
                {income.charges.map((c) => (
                  <div key={c.code} className="flex justify-between">
                    <span className="text-ink-soft">{c.code} — {c.label}</span>
                    <span className="tabular">−{formatFcfa(c.amount)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Résultat net</span>
                  <span className={`tabular ${income.resultatNet >= 0 ? "text-success-fg" : "text-danger-fg"}`}>
                    {formatFcfa(income.resultatNet)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Bilan</CardTitle>
                <CardDescription>
                  {balanceSheet.balanced ? "Actif = Passif" : "Anomalie : actif ≠ passif — contactez le support"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                {balanceSheet.warnings && balanceSheet.warnings.length > 0 && (
                  <div className="mb-2 flex flex-col gap-1 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-xs text-warning-fg">
                    {balanceSheet.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                )}
                <p className="font-label-sm uppercase tracking-wider text-ink-muted">Actif</p>
                {balanceSheet.actif.map((a) => (
                  <div key={a.code} className="flex justify-between">
                    <span className="text-ink-soft">{a.code} — {a.label}</span>
                    <span className="tabular">{formatFcfa(a.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Total actif</span>
                  <span className="tabular">{formatFcfa(balanceSheet.totalActif)}</span>
                </div>
                <p className="mt-2 font-label-sm uppercase tracking-wider text-ink-muted">Passif</p>
                {balanceSheet.passif.map((p) => (
                  <div key={p.code} className="flex justify-between">
                    <span className="text-ink-soft">{p.code} — {p.label}</span>
                    <span className="tabular">{formatFcfa(p.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Total passif</span>
                  <span className="tabular">{formatFcfa(balanceSheet.totalPassif)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">Flux de trésorerie</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-body-sm">
                <div className="flex justify-between">
                  <span className="text-ink-soft">Début de période</span>
                  <span className="tabular">{formatFcfa(cashFlow.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft">Encaissements</span>
                  <span className="tabular text-success-fg">+{formatFcfa(cashFlow.totalInflows)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft">Décaissements</span>
                  <span className="tabular text-danger-fg">−{formatFcfa(cashFlow.totalOutflows)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <span>Fin de période</span>
                  <span className="tabular">{formatFcfa(cashFlow.closingBalance)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">Balance générale</h2>
        </div>
        {lines && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compte</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.accountId}>
                  <TableCell>
                    {l.code} — {l.label}
                  </TableCell>
                  <TableAmount>{formatFcfa(l.totalDebit)}</TableAmount>
                  <TableAmount>{formatFcfa(l.totalCredit)}</TableAmount>
                  <TableAmount>{formatFcfa(l.balance)}</TableAmount>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableAmount>{formatFcfa(totals.totalDebit)}</TableAmount>
                <TableAmount>{formatFcfa(totals.totalCredit)}</TableAmount>
                <TableAmount>{formatFcfa(totals.totalDebit - totals.totalCredit)}</TableAmount>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-label-md uppercase tracking-wider text-ink-muted">Balance auxiliaire des tiers</h2>
          <select
            value={partyType}
            onChange={(e) => setPartyType(e.target.value as ThirdPartyType)}
            className={`${SELECT_CLASS} max-w-xs`}
          >
            {THIRD_PARTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {tiers && tiers.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun tiers pour ce type.</p>
        ) : (
          tiers && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compte auxiliaire</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead className="text-right">Solde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular">{t.auxiliaryCode}</TableCell>
                    <TableCell>{t.displayName}</TableCell>
                    <TableCell className="text-ink-soft">
                      {t.controlAccount.code} — {t.controlAccount.label}
                    </TableCell>
                    <TableAmount>{formatFcfa(t.balance)}</TableAmount>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
      </div>
    </div>
  );
}

// ── Exercices ──────────────────────────────────────────────────────────────

