"use client";

import * as React from "react";
import Link from "next/link";
import { Droplets, Zap, Plus, Search, Check, Trash2, Pencil, Lock, Gauge } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  listCharges,
  updateCharge,
  recordChargePayment,
  deleteCharge,
  type UtilityCharge,
  type UtilityType,
  type ChargeStatus,
} from "@/lib/api/charges";
import { listClosedPeriods } from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { UTILITY_TYPE_LABELS, CHARGE_STATUS_LABELS } from "@/lib/constants/charges";
import { ApiError } from "@/lib/api/client";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

const TABS: { key: ChargeStatus | "all"; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "impayee", label: "Impayées" },
  { key: "partiellement_payee", label: "Partiellement payées" },
  { key: "payee", label: "Payées" },
];

const STATUS_BADGE_VARIANT: Record<ChargeStatus, "success" | "warning" | "info"> = {
  payee: "success",
  partiellement_payee: "info",
  impayee: "warning",
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

export function ChargesView() {
  return (
    <RequireAuth permission="charges">
      <ChargesContent />
    </RequireAuth>
  );
}

function ChargesContent() {
  const { accessToken } = useAuth();
  const [tab, setTab] = React.useState<ChargeStatus | "all">("all");
  const [utilityType, setUtilityType] = React.useState<UtilityType | "all">("all");
  const [query, setQuery] = React.useState("");
  const [charges, setCharges] = React.useState<UtilityCharge[] | null>(null);
  const [closedPeriods, setClosedPeriods] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listCharges(accessToken, {
      status: tab === "all" ? undefined : tab,
      utilityType: utilityType === "all" ? undefined : utilityType,
      q: query || undefined,
    })
      .then((res) => setCharges(res.charges))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les charges."));
  }, [accessToken, tab, utilityType, query]);

  React.useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Mois clôturés (comptabilité) : une facture datée dans un de ces mois
  // devient en lecture seule ici aussi (le serveur la refuserait sinon).
  React.useEffect(() => {
    if (!accessToken) return;
    listClosedPeriods(accessToken)
      .then((res) => setClosedPeriods(new Set(res.periods.map((p) => p.period))))
      .catch(() => {
        // Silencieux : un utilisateur avec seulement `charges` (pas
        // `comptabilite`) garde quand même l'accès en lecture via l'API
        // dédiée ; si ça échouait pour une autre raison, les lignes restent
        // simplement modifiables (au pire, le serveur refusera l'action).
      });
  }, [accessToken]);

  const totalUnpaid = (charges ?? [])
    .filter((c) => c.status !== "payee")
    .reduce((s, c) => s + c.remainingAmount, 0);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Charges SONEB & SBEE</h1>
            <p className="text-body-md text-ink-soft">Factures d&apos;eau et d&apos;électricité à la charge des locataires.</p>
          </div>
          <div className="flex w-fit flex-wrap gap-2">
            <Link href="/espace/charges/releves">
              <Button variant="secondary">
                <Gauge size={18} />
                Relevés par immeuble
              </Button>
            </Link>
            <Link href="/espace/charges/nouveau">
              <Button>
                <Plus size={18} />
                Nouvelle charge
              </Button>
            </Link>
          </div>
        </div>

        {charges && charges.some((c) => c.status !== "payee") && (
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <span className="text-body-sm text-ink-soft">Total impayé (filtres actuels)</span>
              <span className="tabular font-currency-table text-headline-sm text-danger-fg">{formatFcfa(totalUnpaid)}</span>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-label-sm transition-colors",
                  tab === t.key
                    ? "border-primary bg-surface-muted text-ink"
                    : "border-border text-ink-soft hover:bg-surface-hover",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={utilityType}
            onChange={(e) => setUtilityType(e.target.value as UtilityType | "all")}
            className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="all">Tous les fluides</option>
            <option value="soneb">SONEB (Eau)</option>
            <option value="sbee">SBEE (Électricité)</option>
          </select>
          <div className="relative max-w-xs flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher (locataire, unité)"
              className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {charges === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : charges && charges.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Droplets size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucune charge pour le moment</p>
              <Link href="/espace/charges/nouveau">
                <Button variant="info">Enregistrer la première facture</Button>
              </Link>
            </CardContent>
          </Card>
        ) : charges ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Locataire</TableHead>
                <TableHead>Bien / unité</TableHead>
                <TableHead>Fluide</TableHead>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {charges.map((c) => (
                <ChargeRow
                  key={c.id}
                  charge={c}
                  accessToken={accessToken}
                  locked={closedPeriods.has(c.billedAt.slice(0, 7))}
                  onChanged={load}
                />
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}

function ChargeRow({
  charge,
  accessToken,
  locked,
  onChanged,
}: {
  charge: UtilityCharge;
  accessToken: string | null;
  locked: boolean;
  onChanged: () => void;
}) {
  const [paying, setPaying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = React.useState(String(charge.remainingAmount));
  const [readingStart, setReadingStart] = React.useState(String(charge.readingStart));
  const [readingEnd, setReadingEnd] = React.useState(String(charge.readingEnd));
  const [unitPrice, setUnitPrice] = React.useState(String(charge.unitPrice));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const editedConsumption =
    readingStart !== "" && readingEnd !== "" && Number(readingEnd) >= Number(readingStart)
      ? Number(readingEnd) - Number(readingStart)
      : null;
  const editedAmount = editedConsumption !== null && unitPrice ? Math.round(editedConsumption * Number(unitPrice)) : null;

  async function handlePay() {
    if (!accessToken) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0 || amount > charge.remainingAmount) {
      return setError(`Montant invalide (solde restant : ${formatFcfa(charge.remainingAmount)}).`);
    }
    setSubmitting(true);
    setError(null);
    try {
      await recordChargePayment(accessToken, charge.id, { amount, paymentMethod: method, paidAt });
      setPaying(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit() {
    if (!accessToken) return;
    if (readingStart === "" || readingEnd === "" || Number(readingEnd) < Number(readingStart)) {
      return setError("Index invalides.");
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateCharge(accessToken, charge.id, {
        readingStart: Number(readingStart),
        readingEnd: Number(readingEnd),
        unitPrice: Number(unitPrice),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!accessToken || deleteReason.trim().length < 5) return;
    setSubmitting(true);
    try {
      await deleteCharge(accessToken, charge.id, deleteReason.trim());
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer.");
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input inputMode="numeric" value={readingStart} onChange={(e) => setReadingStart(e.target.value.replace(/\D/g, ""))} placeholder="Index début" />
              <Input inputMode="numeric" value={readingEnd} onChange={(e) => setReadingEnd(e.target.value.replace(/\D/g, ""))} placeholder="Index fin" />
              <Input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Prix unitaire" />
            </div>
            <p className="text-body-sm text-ink-soft">
              Consommation : {editedConsumption ?? "—"} · Montant recalculé :{" "}
              <span className="font-label-md text-ink">{editedAmount !== null ? formatFcfa(editedAmount) : "—"}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSaveEdit} disabled={submitting}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={submitting}>Annuler</Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (paying) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Enregistrer un règlement pour {charge.renter.firstName} {charge.renter.lastName} — solde restant :{" "}
              <span className="font-label-md">{formatFcfa(charge.remainingAmount)}</span>
              {charge.paidAmount > 0 && <span className="text-ink-muted"> (déjà réglé : {formatFcfa(charge.paidAmount)})</span>}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Montant réglé (FCFA)" htmlFor={`amount-${charge.id}`} required>
                <Input
                  id={`amount-${charge.id}`}
                  inputMode="numeric"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Mode de règlement" htmlFor={`method-${charge.id}`}>
                <select
                  id={`method-${charge.id}`}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date de règlement" htmlFor={`paidAt-${charge.id}`}>
                <Input id={`paidAt-${charge.id}`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </Field>
            </div>
            {Number(payAmount) > 0 && Number(payAmount) < charge.remainingAmount && (
              <p className="text-body-xs text-info-fg">
                Règlement partiel — il restera {formatFcfa(charge.remainingAmount - Number(payAmount))} après ce paiement.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handlePay} disabled={submitting}>
                {submitting ? "…" : "Confirmer le règlement"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPaying(false)} disabled={submitting}>Annuler</Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (confirmDelete) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Supprimer cette facture {UTILITY_TYPE_LABELS[charge.utilityType]} de {formatFcfa(charge.amount)} pour{" "}
              {charge.renter.firstName} {charge.renter.lastName} ? Une justification est obligatoire — la suppression
              restera tracée et visible du DG, mais sortira des totaux.
            </p>
            <Field label="Justification" htmlFor={`delReason-${charge.id}`} required hint="5 caractères minimum">
              <Input
                id={`delReason-${charge.id}`}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ex. Erreur de saisie sur l'index"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={submitting || deleteReason.trim().length < 5}
              >
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setConfirmDelete(false); setDeleteReason(""); }}
                disabled={submitting}
              >
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Link href={`/espace/locataires/${charge.renter.id}`} className="text-primary hover:underline">
          {charge.renter.firstName} {charge.renter.lastName}
        </Link>
      </TableCell>
      <TableCell className="text-ink-soft">{charge.property.code} · {charge.unit.code}</TableCell>
      <TableCell className="text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          {charge.utilityType === "soneb" ? <Droplets size={14} /> : <Zap size={14} />}
          {UTILITY_TYPE_LABELS[charge.utilityType]}
        </span>
      </TableCell>
      <TableCell className="text-ink-soft">{charge.periodStart} → {charge.periodEnd}</TableCell>
      <TableAmount>
        {formatFcfa(charge.amount)}
        {charge.lossShareAmount > 0 && (
          <div className="text-body-xs font-body text-ink-muted">
            dont {formatFcfa(charge.lossShareAmount)} de part de pertes
          </div>
        )}
        {charge.status === "partiellement_payee" && (
          <div className="text-body-xs font-body text-info-fg">reste {formatFcfa(charge.remainingAmount)}</div>
        )}
      </TableAmount>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[charge.status]}>{CHARGE_STATUS_LABELS[charge.status]}</Badge>
      </TableCell>
      <TableCell className="text-right">
        {locked ? (
          <Badge variant="neutral">
            <Lock size={11} /> Clôturé
          </Badge>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {charge.status !== "payee" && (
              <Button
                variant="success"
                size="sm"
                onClick={() => { setPayAmount(String(charge.remainingAmount)); setPaying(true); }}
              >
                <Check size={14} />
                {charge.status === "partiellement_payee" ? "Régler le solde" : "Marquer payée"}
              </Button>
            )}
            {charge.paidAmount === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Modifier">
                <Pencil size={14} />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
              <Trash2 size={14} className="text-danger-fg" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
