"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Undo2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  listGlEntries,
  getGlEntry,
  createManualGlEntry,
  extourneGlEntry,
  getThirdPartyBalance,
  type GlAccount,
  type GlJournal,
  type GlFiscalYear,
  type GlEntry,
  type GlEntryStatus,
  type GlEntryLine,
  type CreateManualEntryLineInput,
  type ThirdPartyType,
  type ThirdPartyBalanceLine,
} from "@/lib/api/gl";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { todayIso } from "@/lib/dates";
import { THIRD_PARTY_TYPES } from "./balance-tab";
import { SELECT_CLASS } from "./shared";

export function JournalTab({
  accessToken,
  accounts,
  journals,
  openFiscalYear,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  journals: GlJournal[];
  openFiscalYear: GlFiscalYear | null;
}) {
  const [entries, setEntries] = React.useState<GlEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  // Filtrage du journal (audit comptabilité avancée, point 5, 16/10/2026) : le backend accepte déjà
  // `from`/`to`/`journalId`/`status` (voir `listGlEntries`), jamais branché côté interface — un cabinet
  // actif ne pouvait pas consulter, par ex., le seul journal de banque d'un mois donné, sans tout
  // parcourir (plafonné à 500 lignes, voir la route).
  const [journalId, setJournalId] = React.useState<number | "">("");
  const [status, setStatus] = React.useState<GlEntryStatus | "">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listGlEntries(accessToken, {
      journalId: journalId || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal."));
  }, [accessToken, journalId, status, from, to]);

  React.useEffect(() => load(), [load]);

  const hasFilters = journalId !== "" || status !== "" || from !== "" || to !== "";
  function resetFilters() {
    setJournalId("");
    setStatus("");
    setFrom("");
    setTo("");
  }

  return (
    <div className="flex flex-col gap-4">
      <ManualEntryForm
        accessToken={accessToken}
        accounts={accounts}
        journals={journals}
        openFiscalYear={openFiscalYear}
        onCreated={load}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Journal" htmlFor="journalFilter">
          <select
            id="journalFilter"
            value={journalId}
            onChange={(e) => setJournalId(e.target.value ? Number(e.target.value) : "")}
            className={`${SELECT_CLASS} max-w-[220px]`}
          >
            <option value="">Tous</option>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statut" htmlFor="statusFilter">
          <select
            id="statusFilter"
            value={status}
            onChange={(e) => setStatus(e.target.value as GlEntryStatus | "")}
            className={`${SELECT_CLASS} max-w-[160px]`}
          >
            <option value="">Tous</option>
            {(Object.keys(STATUS_BADGE) as GlEntryStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_BADGE[s].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Du" htmlFor="fromFilter">
          <Input id="fromFilter" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[160px]" />
        </Field>
        <Field label="Au" htmlFor="toFilter">
          <Input id="toFilter" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[160px]" />
        </Field>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            Réinitialiser
          </Button>
        )}
      </div>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      {!entries ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="text-body-sm text-ink-muted">
          {hasFilters ? "Aucune écriture ne correspond à ces filtres." : "Aucune écriture pour l'instant."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N°</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Journal</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                accessToken={accessToken}
                expanded={expandedId === e.id}
                onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                onChanged={load}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export const STATUS_BADGE: Record<GlEntry["status"], { label: string; variant: "success" | "neutral" | "warning" }> = {
  validee: { label: "Validée", variant: "success" },
  brouillon: { label: "Brouillon", variant: "neutral" },
  extournee: { label: "Extournée", variant: "warning" },
};

export function EntryRow({
  entry,
  accessToken,
  expanded,
  onToggle,
  onChanged,
}: {
  entry: GlEntry;
  accessToken: string | null;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [lines, setLines] = React.useState<GlEntryLine[] | null>(null);
  const [showExtourne, setShowExtourne] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(todayIso());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!expanded || !accessToken || lines) return;
    getGlEntry(accessToken, entry.id).then((res) => setLines(res.lines));
  }, [expanded, accessToken, entry.id, lines]);

  async function handleExtourne(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await extourneGlEntry(accessToken, entry.id, { entryDate, reason: reason.trim() });
      toast.success(`Écriture n°${entry.entryNumber} extournée.`);
      setShowExtourne(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'extourner cette écriture.");
    } finally {
      setSubmitting(false);
    }
  }

  const canReverse = entry.status === "validee";
  const badge = STATUS_BADGE[entry.status];

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="tabular">{entry.entryNumber}</TableCell>
        <TableCell>{formatDateLabel(entry.entryDate)}</TableCell>
        <TableCell>{entry.journal.code}</TableCell>
        <TableCell>{entry.narration}</TableCell>
        <TableCell>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </TableCell>
        <TableCell>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="!bg-surface-muted">
          <TableCell colSpan={6}>
            <div className="flex flex-col gap-3 py-2">
              {!lines ? (
                <p className="text-body-sm text-ink-muted">Chargement…</p>
              ) : (
                <table className="w-full text-body-sm">
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3">
                          {l.accountCode} — {l.accountLabel}
                          {l.thirdParty && <span className="text-ink-faint"> ({l.thirdParty.name})</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">{l.side === "debit" ? formatFcfa(l.amount) : ""}</td>
                        <td className="py-1.5 text-right tabular">{l.side === "credit" ? formatFcfa(l.amount) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {canReverse && !showExtourne && (
                <Button
                  variant="warning"
                  size="sm"
                  className="self-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowExtourne(true);
                  }}
                >
                  <Undo2 size={14} />
                  Extourner cette écriture
                </Button>
              )}

              {showExtourne && (
                <form
                  onSubmit={handleExtourne}
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-bg p-3"
                >
                  <p className="text-body-sm text-warning-fg">
                    L&apos;extourne crée une écriture miroir qui annule celle-ci — irréversible, jamais de suppression
                    directe.
                  </p>
                  {error && <p className="text-body-sm text-danger-fg">{error}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Date de l'extourne" htmlFor={`extDate-${entry.id}`} required>
                      <Input id={`extDate-${entry.id}`} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                    </Field>
                    <Field label="Justification" htmlFor={`extReason-${entry.id}`} required>
                      <Input id={`extReason-${entry.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="warning" size="sm" disabled={submitting || reason.trim().length < 5}>
                      {submitting ? "Extourne en cours…" : "Confirmer l'extourne"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowExtourne(false)}>
                      Annuler
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Ligne du formulaire : `partyType` est un champ purement local (pilote quelle liste de tiers
// proposer), jamais envoyé au serveur — voir `toSubmittedLines` ci-dessous.
export type ManualLineState = CreateManualEntryLineInput & { partyType?: ThirdPartyType };

export function ManualEntryForm({
  accessToken,
  accounts,
  journals,
  openFiscalYear,
  onCreated,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  journals: GlJournal[];
  openFiscalYear: GlFiscalYear | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Bug corrigé (audit comptabilité avancée, point 6, 16/10/2026) : les comptes de tiers étaient
  // jusqu'ici exclus de ce formulaire (éviter un 400 déroutant côté serveur, qui exige un tiers sur
  // ces comptes) — aucun moyen de corriger/reclasser une écriture tiers à la main. Tous les comptes
  // actifs sont désormais proposés ; un compte collectif ouvre un sélecteur de tiers EXISTANT dédié.
  const selectableAccounts = accounts.filter((a) => a.isActive);
  const odJournal = journals.find((j) => j.code === "OD") ?? journals[0] ?? null;

  const [journalId, setJournalId] = React.useState<number | null>(odJournal?.id ?? null);
  const [entryDate, setEntryDate] = React.useState(todayIso());
  const [narration, setNarration] = React.useState("");
  const [lines, setLines] = React.useState<ManualLineState[]>([
    { accountId: 0, side: "debit", amount: 0 },
    { accountId: 0, side: "credit", amount: 0 },
  ]);
  const [tiersByType, setTiersByType] = React.useState<Partial<Record<ThirdPartyType, ThirdPartyBalanceLine[]>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (journalId === null && odJournal) setJournalId(odJournal.id);
  }, [odJournal, journalId]);

  function ensureTiersLoaded(partyType: ThirdPartyType) {
    if (!accessToken || tiersByType[partyType]) return;
    getThirdPartyBalance(accessToken, partyType)
      .then((res) => setTiersByType((prev) => ({ ...prev, [partyType]: res.thirdParties })))
      .catch(() => {}); // la ligne affichera simplement une liste vide ; l'erreur globale couvre déjà le formulaire
  }

  const totalDebit = lines.filter((l) => l.side === "debit").reduce((s, l) => s + (l.amount || 0), 0);
  const totalCredit = lines.filter((l) => l.side === "credit").reduce((s, l) => s + (l.amount || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;
  // Toute ligne sur un compte collectif doit avoir son tiers choisi — même exigence que le serveur
  // (`routes/gl/glEntries.js`), vérifiée ici pour ne jamais soumettre une écriture qui serait de toute
  // façon refusée.
  const allTiersSelected = lines.every((l) => {
    const account = accounts.find((a) => a.id === l.accountId);
    return !account?.isControlAccount || !!l.thirdPartyId;
  });

  function updateLine(i: number, patch: Partial<ManualLineState>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function selectAccountForLine(i: number, accountId: number) {
    const account = accounts.find((a) => a.id === accountId);
    if (account?.isControlAccount) {
      const partyType: ThirdPartyType = "renter";
      ensureTiersLoaded(partyType);
      updateLine(i, { accountId, partyType, thirdPartyId: undefined });
    } else {
      updateLine(i, { accountId, partyType: undefined, thirdPartyId: undefined });
    }
  }

  function selectPartyTypeForLine(i: number, partyType: ThirdPartyType) {
    ensureTiersLoaded(partyType);
    updateLine(i, { partyType, thirdPartyId: undefined });
  }

  function addLine() {
    setLines((prev) => [...prev, { accountId: 0, side: "debit", amount: 0 }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !journalId) return;
    setSubmitting(true);
    setError(null);
    try {
      // `partyType` est un champ local uniquement (pilote le sélecteur ci-dessous) — jamais transmis.
      const submittedLines: CreateManualEntryLineInput[] = lines.map(({ accountId, thirdPartyId, side, amount }) => ({
        accountId,
        thirdPartyId,
        side,
        amount,
      }));
      await createManualGlEntry(accessToken, { journalId, entryDate, narration: narration.trim(), lines: submittedLines });
      toast.success("Écriture manuelle enregistrée.");
      setOpen(false);
      setNarration("");
      setLines([
        { accountId: 0, side: "debit", amount: 0 },
        { accountId: 0, side: "credit", amount: 0 },
      ]);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette écriture.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Saisie manuelle</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)} disabled={!openFiscalYear}>
          <Plus size={14} />
          {open ? "Fermer" : "Écriture diverse"}
        </Button>
      </div>
      {!openFiscalYear && <p className="text-body-xs text-ink-muted">Ouvrez un exercice pour saisir une écriture.</p>}

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Journal" htmlFor="mJournal" required>
              <select
                id="mJournal"
                value={journalId ?? ""}
                onChange={(e) => setJournalId(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="mDate" required>
              <Input id="mDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </Field>
            <Field label="Libellé" htmlFor="mNarration" required>
              <Input id="mNarration" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => {
              const account = accounts.find((a) => a.id === line.accountId);
              const tiersOptions = line.partyType ? (tiersByType[line.partyType] ?? []) : [];
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_140px_32px] sm:items-end">
                    <Field label="Compte" htmlFor={`mAccount-${i}`}>
                      <select
                        id={`mAccount-${i}`}
                        value={line.accountId || ""}
                        onChange={(e) => selectAccountForLine(i, Number(e.target.value))}
                        className={SELECT_CLASS}
                      >
                        <option value="" disabled>
                          Choisir…
                        </option>
                        {selectableAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.label}
                            {a.isControlAccount ? " (tiers)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sens" htmlFor={`mSide-${i}`}>
                      <select
                        id={`mSide-${i}`}
                        value={line.side}
                        onChange={(e) => updateLine(i, { side: e.target.value as "debit" | "credit" })}
                        className={SELECT_CLASS}
                      >
                        <option value="debit">Débit</option>
                        <option value="credit">Crédit</option>
                      </select>
                    </Field>
                    <Field label="Montant" htmlFor={`mAmount-${i}`}>
                      <Input
                        id={`mAmount-${i}`}
                        inputMode="numeric"
                        value={line.amount || ""}
                        onChange={(e) => updateLine(i, { amount: Number(e.target.value.replace(/\D/g, "")) })}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={lines.length <= 2}
                      onClick={() => removeLine(i)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>

                  {account?.isControlAccount && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr] sm:items-end">
                      <Field label="Type de tiers" htmlFor={`mPartyType-${i}`}>
                        <select
                          id={`mPartyType-${i}`}
                          value={line.partyType ?? ""}
                          onChange={(e) => selectPartyTypeForLine(i, e.target.value as ThirdPartyType)}
                          className={SELECT_CLASS}
                        >
                          {THIRD_PARTY_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label="Tiers"
                        htmlFor={`mThirdParty-${i}`}
                        hint={tiersOptions.length === 0 ? "Aucun tiers existant de ce type pour l'instant." : undefined}
                      >
                        <select
                          id={`mThirdParty-${i}`}
                          value={line.thirdPartyId ?? ""}
                          onChange={(e) => updateLine(i, { thirdPartyId: Number(e.target.value) || undefined })}
                          className={SELECT_CLASS}
                        >
                          <option value="" disabled>
                            Choisir…
                          </option>
                          {tiersOptions.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.displayName} — {t.controlAccount.code} ({formatFcfa(t.balance)})
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addLine}>
              <Plus size={14} />
              Ajouter une ligne
            </Button>
          </div>

          <p className={`text-body-sm ${balanced ? "text-success-fg" : "text-danger-fg"}`}>
            Débit {formatFcfa(totalDebit)} — Crédit {formatFcfa(totalCredit)}
            {!balanced && " (déséquilibrée)"}
          </p>
          {!allTiersSelected && (
            <p className="text-body-sm text-danger-fg">Choisissez un tiers pour chaque ligne sur un compte collectif.</p>
          )}

          <Button type="submit" disabled={submitting || !balanced || !allTiersSelected || !narration.trim()} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer l'écriture"}
          </Button>
        </form>
      )}
    </div>
  );
}

// ── Grand livre ────────────────────────────────────────────────────────────

