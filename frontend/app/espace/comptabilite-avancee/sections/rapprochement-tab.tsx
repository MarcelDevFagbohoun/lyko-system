"use client";

import * as React from "react";
import {
  Landmark,
  Scale,
  Plus,
  Undo2,
  Lock,
  CheckCircle2,
  CircleCheck,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  listBankReconciliations,
  startBankReconciliation,
  updateBankReconciliationStatement,
  getBankReconciliation,
  pointBankMovement,
  addBankOnlyLine,
  removeBankReconciliationLine,
  finalizeBankReconciliation,
  type BankReconciliation,
  type BankReconciliationDetail,
} from "@/lib/api/gl";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { SELECT_CLASS } from "./shared";

export function RapprochementTab({ accessToken }: { accessToken: string | null }) {
  const [reconciliations, setReconciliations] = React.useState<BankReconciliation[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listBankReconciliations(accessToken)
      .then((res) => setReconciliations(res.reconciliations))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les rapprochements bancaires."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  if (selectedId !== null) {
    return (
      <RapprochementDetail
        accessToken={accessToken}
        reconciliationId={selectedId}
        onBack={() => setSelectedId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-ink-soft">
        Compare le solde du compte banque (521) tel que calculé par la comptabilité avec le solde réel de votre
        relevé bancaire, mois par mois. Aucune connexion bancaire : le solde du relevé se saisit à la main.
      </p>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      <NewReconciliationForm accessToken={accessToken} onCreated={(id) => { load(); setSelectedId(id); }} />

      {reconciliations === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : reconciliations.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucun rapprochement enregistré.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Période</TableHead>
              <TableHead className="text-right">Solde relevé</TableHead>
              <TableHead className="text-right">Solde comptable</TableHead>
              <TableHead className="text-right">Écart</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconciliations.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedId(r.id)}>
                <TableCell>{r.period}</TableCell>
                <TableAmount>{formatFcfa(r.statementBalance)}</TableAmount>
                <TableAmount>{formatFcfa(r.bookBalance)}</TableAmount>
                <TableCell className={`text-right tabular ${r.gap === 0 ? "text-success-fg" : "text-warning-fg"}`}>
                  {formatFcfa(r.gap)}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "rapproche" ? "success" : "neutral"}>
                    {r.status === "rapproche" ? "Clôturé" : "En cours"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedId(r.id)}>
                    Ouvrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function NewReconciliationForm({ accessToken, onCreated }: { accessToken: string | null; onCreated: (id: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const [period, setPeriod] = React.useState(() => new Date().toISOString().slice(0, 7));
  const [statementBalance, setStatementBalance] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startBankReconciliation(accessToken, { period, statementBalance: Number(statementBalance) });
      setOpen(false);
      setStatementBalance("");
      toast.success(`Rapprochement de ${period} démarré.`);
      onCreated(res.reconciliationId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer ce rapprochement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouveau rapprochement</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Démarrer un rapprochement"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mois du relevé" htmlFor="brPeriod" required>
              <input
                id="brPeriod"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={SELECT_CLASS}
              />
            </Field>
            <Field label="Solde de fin de mois (relevé bancaire)" htmlFor="brBalance" required hint="Tel qu'indiqué sur votre relevé papier ou PDF">
              <Input
                id="brBalance"
                inputMode="numeric"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value.replace(/[^\d-]/g, ""))}
              />
            </Field>
          </div>
          <Button type="submit" disabled={submitting || !period || statementBalance === ""} className="self-start">
            {submitting ? "Démarrage…" : "Démarrer le rapprochement"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function RapprochementDetail({
  accessToken,
  reconciliationId,
  onBack,
  onChanged,
}: {
  accessToken: string | null;
  reconciliationId: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<BankReconciliationDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pointingId, setPointingId] = React.useState<number | null>(null);
  const [removingId, setRemovingId] = React.useState<number | null>(null);
  const [addingBankLine, setAddingBankLine] = React.useState(false);
  const [bankReference, setBankReference] = React.useState("");
  const [bankAmount, setBankAmount] = React.useState("");
  const [bankDate, setBankDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [finalizing, setFinalizing] = React.useState(false);
  const [confirmForce, setConfirmForce] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getBankReconciliation(accessToken, reconciliationId)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger ce rapprochement."));
  }, [accessToken, reconciliationId]);

  React.useEffect(() => load(), [load]);

  async function handlePoint(entryLineId: number) {
    if (!accessToken) return;
    setPointingId(entryLineId);
    setError(null);
    try {
      await pointBankMovement(accessToken, reconciliationId, entryLineId);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de pointer ce mouvement.");
    } finally {
      setPointingId(null);
    }
  }

  async function handleRemove(lineId: number) {
    if (!accessToken) return;
    setRemovingId(lineId);
    setError(null);
    try {
      await removeBankReconciliationLine(accessToken, reconciliationId, lineId);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de retirer cette ligne.");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleAddBankLine(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    try {
      await addBankOnlyLine(accessToken, reconciliationId, {
        bankReference: bankReference.trim() || undefined,
        bankAmount: Number(bankAmount),
        bankDate,
      });
      setAddingBankLine(false);
      setBankReference("");
      setBankAmount("");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette ligne.");
    }
  }

  async function handleFinalize(force: boolean) {
    if (!accessToken) return;
    setFinalizing(true);
    setError(null);
    try {
      await finalizeBankReconciliation(accessToken, reconciliationId, force);
      setConfirmForce(false);
      toast.success("Rapprochement clôturé.");
      load();
      onChanged();
    } catch (err) {
      if (!force) {
        // Refusé sans confirmation (mouvements non pointés ou écart non nul) —
        // proposé ci-dessous comme un choix explicite, jamais bloqué en silence.
        setConfirmForce(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de clôturer ce rapprochement.");
      }
    } finally {
      setFinalizing(false);
    }
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
          <ArrowLeft size={14} /> Retour
        </Button>
        {error ? <p className="text-body-sm text-danger-fg">{error}</p> : <p className="text-body-sm text-ink-muted">Chargement…</p>}
      </div>
    );
  }

  const { reconciliation, lines, unmatchedBookMovements } = detail;
  const isOpen = reconciliation.status === "en_cours";
  const canFinalizeCleanly = unmatchedBookMovements.length === 0 && reconciliation.gap === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} /> Retour à la liste
        </Button>
        <Badge variant={reconciliation.status === "rapproche" ? "success" : "neutral"}>
          {reconciliation.status === "rapproche" ? "Clôturé" : "En cours"}
        </Badge>
      </div>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`Solde relevé — ${reconciliation.period}`} icon={<Landmark size={16} />} value={formatFcfa(reconciliation.statementBalance)} />
        <StatCard label="Solde comptable (compte 521)" icon={<Scale size={16} />} value={formatFcfa(reconciliation.bookBalance)} />
        <StatCard
          label="Écart"
          icon={reconciliation.gap === 0 ? <CircleCheck size={16} /> : <AlertTriangle size={16} />}
          value={formatFcfa(reconciliation.gap)}
          tone={reconciliation.gap === 0 ? "success" : "warning"}
        />
      </div>

      {isOpen && reconciliation.gap !== 0 && (
        <Field label="Corriger le solde du relevé" htmlFor="brEditBalance" hint="En cas d'erreur de saisie au démarrage">
          <EditStatementBalance
            accessToken={accessToken}
            reconciliationId={reconciliationId}
            current={reconciliation.statementBalance}
            onChanged={() => { load(); onChanged(); }}
          />
        </Field>
      )}

      <div>
        <p className="mb-2 font-label-sm uppercase tracking-wider text-ink-muted">
          Mouvements comptables pas encore pointés ({unmatchedBookMovements.length})
        </p>
        {unmatchedBookMovements.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Tous les mouvements de ce compte, jusqu&apos;à la fin du mois, sont pointés.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>N° pièce</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                {isOpen && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmatchedBookMovements.map((m) => (
                <TableRow key={m.entryLineId}>
                  <TableCell className="text-ink-soft">{m.entryDate}</TableCell>
                  <TableCell className="text-ink-soft">{m.entryNumber}</TableCell>
                  <TableCell>{m.narration}</TableCell>
                  <TableAmount>{m.side === "debit" ? formatFcfa(m.amount) : ""}</TableAmount>
                  <TableAmount>{m.side === "credit" ? formatFcfa(m.amount) : ""}</TableAmount>
                  {isOpen && (
                    <TableCell className="text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pointingId === m.entryLineId}
                        onClick={() => handlePoint(m.entryLineId)}
                      >
                        <CheckCircle2 size={14} />
                        {pointingId === m.entryLineId ? "Pointage…" : "Pointer"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-label-sm uppercase tracking-wider text-ink-muted">Lignes du relevé bancaire ({lines.length})</p>
          {isOpen && (
            <Button variant="secondary" size="sm" onClick={() => setAddingBankLine((v) => !v)}>
              <Plus size={14} />
              {addingBankLine ? "Fermer" : "Ajouter une opération vue sur le relevé"}
            </Button>
          )}
        </div>

        {addingBankLine && (
          <form onSubmit={handleAddBankLine} className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <p className="text-body-xs text-ink-muted">
              Pour une opération que vous voyez sur le relevé mais qui n&apos;apparaît dans aucune de vos écritures
              (ex. frais bancaires, agios) — à enregistrer séparément comme dépense une fois repérée ici.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Référence (libellé banque)" htmlFor="brBankRef">
                <Input id="brBankRef" value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
              </Field>
              <Field label="Montant" htmlFor="brBankAmount" required>
                <Input
                  id="brBankAmount"
                  inputMode="numeric"
                  value={bankAmount}
                  onChange={(e) => setBankAmount(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Date" htmlFor="brBankDate" required>
                <Input id="brBankDate" type="date" value={bankDate} onChange={(e) => setBankDate(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={!bankAmount || !bankDate} className="self-start">
              Enregistrer
            </Button>
          </form>
        )}

        {lines.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune ligne saisie pour l&apos;instant.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Référence / libellé</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Origine</TableHead>
                {isOpen && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-ink-soft">{l.bankDate}</TableCell>
                  <TableCell>{l.entryLine ? l.entryLine.narration : l.bankReference || "—"}</TableCell>
                  <TableAmount>{formatFcfa(l.bankAmount)}</TableAmount>
                  <TableCell>
                    {l.entryLine ? (
                      <Badge variant="success">Pointé (écriture existante)</Badge>
                    ) : (
                      <Badge variant="warning">Vu sur le relevé seulement</Badge>
                    )}
                  </TableCell>
                  {isOpen && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" disabled={removingId === l.id} onClick={() => handleRemove(l.id)}>
                        <Undo2 size={14} />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {isOpen && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {confirmForce ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-bg p-4">
              <p className="inline-flex items-center gap-2 text-body-sm text-warning-fg">
                <AlertTriangle size={16} />
                {unmatchedBookMovements.length > 0
                  ? `${unmatchedBookMovements.length} mouvement(s) ne sont pas encore pointés`
                  : "L'écart n'est pas nul"}
                {" "}— clôturer quand même ? Cette action est définitive.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" disabled={finalizing} onClick={() => handleFinalize(true)}>
                  {finalizing ? "Clôture…" : "Oui, clôturer quand même"}
                </Button>
                <Button variant="ghost" size="sm" disabled={finalizing} onClick={() => setConfirmForce(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant={canFinalizeCleanly ? "primary" : "warning"}
              size="sm"
              className="self-start"
              disabled={finalizing}
              onClick={() => handleFinalize(false)}
            >
              <Lock size={14} />
              {finalizing ? "Clôture…" : "Clôturer le rapprochement"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function EditStatementBalance({
  accessToken,
  reconciliationId,
  current,
  onChanged,
}: {
  accessToken: string | null;
  reconciliationId: number;
  current: number;
  onChanged: () => void;
}) {
  const [value, setValue] = React.useState(String(current));
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      await updateBankReconciliationStatement(accessToken, reconciliationId, Number(value));
      toast.success("Solde du relevé mis à jour.");
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de mettre à jour ce solde.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ""))} className="max-w-[200px]" />
      <Button size="sm" variant="secondary" disabled={submitting || Number(value) === current} onClick={handleSave}>
        {submitting ? "…" : "Mettre à jour"}
      </Button>
    </div>
  );
}

// ── Règles comptables ──────────────────────────────────────────────────────

