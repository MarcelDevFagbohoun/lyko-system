"use client";

import { SectionTile } from "@/components/ui/section-tile";
import * as React from "react";
import { ApiError } from "@/lib/api/client";
import {
  payOpeningDebt,
  getOpeningDebtItems,
  payOpeningDebtItem,
  OPENING_DEBT_TYPE_LABELS,
  type Lease,
  type PaymentMethod,
  type OpeningDebtItem,
} from "@/lib/api/renters";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Badge } from "@/components/ui/badge";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";


export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

/**
 * Impayés existants à l'entrée (onboarding d'un locataire déjà en place
 * avant Africa Immo Management, voir `leases.opening_debt_amount`) — n'affiche rien du
 * tout pour l'immense majorité des baux (aucun impayé déclaré à la création).
 * Se règle indépendamment du registre de loyer ci-dessous (aucun mois de
 * loyer concerné, aucune quittance).
 */
/**
 * Détail par type + mois (demande utilisateur, 2026-11-12) si ce bail a été créé avec ce détail ;
 * retombe sur l'ancien affichage à un seul total (`LegacyOpeningDebtSection` ci-dessous) sinon — la
 * grande majorité des baux existants n'ont aucun poste.
 */
export function OpeningDebtSection({
  lease,
  accessToken,
  onSettled,
  readOnly = false,
}: {
  lease: Lease;
  accessToken: string | null;
  onSettled: () => void;
  readOnly?: boolean;
}) {
  const [items, setItems] = React.useState<OpeningDebtItem[] | null>(null);

  const reload = React.useCallback(() => {
    if (!accessToken || lease.openingDebtAmount <= 0) return;
    getOpeningDebtItems(accessToken, lease.id)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [accessToken, lease.id, lease.openingDebtAmount]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  if (lease.openingDebtAmount <= 0) return null;
  if (items === null) return null;
  if (items.length === 0) {
    return <LegacyOpeningDebtSection lease={lease} accessToken={accessToken} onSettled={onSettled} readOnly={readOnly} />;
  }

  return (
    <OpeningDebtItemsList
      lease={lease}
      items={items}
      accessToken={accessToken}
      readOnly={readOnly}
      onSettled={() => {
        reload();
        onSettled();
      }}
    />
  );
}

/**
 * Affiche et règle, poste par poste, le détail des impayés par type + mois d'un bail (quand il en a).
 */
function OpeningDebtItemsList({
  lease,
  items,
  accessToken,
  readOnly,
  onSettled,
}: {
  lease: Lease;
  items: OpeningDebtItem[];
  accessToken: string | null;
  readOnly: boolean;
  onSettled: () => void;
}) {
  const [openItemId, setOpenItemId] = React.useState<number | null>(null);
  const totalRemaining = items.reduce((sum, i) => sum + i.remaining, 0);

  return (
    <SectionTile tone="violet">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Impayés existants à l&apos;entrée</span>
        {totalRemaining > 0 ? (
          <Badge variant="warning">Reste dû : {formatFcfa(totalRemaining)}</Badge>
        ) : (
          <Badge variant="success">Soldée</Badge>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <OpeningDebtItemRow
            key={item.id}
            leaseId={lease.id}
            item={item}
            accessToken={accessToken}
            readOnly={readOnly}
            open={openItemId === item.id}
            onToggle={() => setOpenItemId((id) => (id === item.id ? null : item.id))}
            onSettled={() => {
              setOpenItemId(null);
              onSettled();
            }}
          />
        ))}
      </div>
    </SectionTile>
  );
}

function OpeningDebtItemRow({
  leaseId,
  item,
  accessToken,
  readOnly,
  open,
  onToggle,
  onSettled,
}: {
  leaseId: number;
  item: OpeningDebtItem;
  accessToken: string | null;
  readOnly: boolean;
  open: boolean;
  onToggle: () => void;
  onSettled: () => void;
}) {
  const [amount, setAmount] = React.useState(String(item.remaining));
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payOpeningDebtItem(accessToken, leaseId, item.id, {
        amount: Number(amount),
        paymentMethod: method,
        paidAt,
        notes: notes.trim() || undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      toast.success(`${formatFcfa(Number(amount))} réglés pour ce poste.`);
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-label-sm text-danger-fg">{monthLabelFr(item.periodMonth)}</span>
          <span className="ml-2 text-body-sm text-ink-soft">
            {OPENING_DEBT_TYPE_LABELS[item.debtType]}
            {item.label ? ` · ${item.label}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular font-currency-table text-body-sm text-ink">{formatFcfa(item.amount)}</span>
          {item.status === "payee" ? (
            <Badge variant="success">Soldé</Badge>
          ) : (
            <Badge variant="warning">Reste {formatFcfa(item.remaining)}</Badge>
          )}
          {item.status !== "payee" && !readOnly && (
            <Button variant="warning" size="sm" onClick={onToggle}>
              {open ? "Fermer" : "Régler"}
            </Button>
          )}
        </div>
      </div>

      {open && item.status !== "payee" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Montant réglé (FCFA)" htmlFor={`openingDebtItemAmount-${item.id}`} required hint={`Reste dû : ${formatFcfa(item.remaining)}`}>
            <Input
              id={`openingDebtItemAmount-${item.id}`}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor={`openingDebtItemMethod-${item.id}`} required>
              <select
                id={`openingDebtItemMethod-${item.id}`}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de règlement" htmlFor={`openingDebtItemPaidAt-${item.id}`} required>
              <Input id={`openingDebtItemPaidAt-${item.id}`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor={`openingDebtItemNotes-${item.id}`}>
            <Input id={`openingDebtItemNotes-${item.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer le règlement"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** Ancien affichage à un seul total — utilisé quand le bail n'a aucun détail par type + mois. */
function LegacyOpeningDebtSection({
  lease,
  accessToken,
  onSettled,
  readOnly = false,
}: {
  lease: Lease;
  accessToken: string | null;
  onSettled: () => void;
  // Bail archivé (demande utilisateur, 2026-11-06) : montant dû toujours CONSULTABLE, mais plus aucun
  // règlement ne peut être enregistré depuis cette fiche.
  readOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const remaining = lease.openingDebtRemaining ?? lease.openingDebtAmount;
  const [amount, setAmount] = React.useState(String(remaining));
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();

  if (lease.openingDebtAmount <= 0) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payOpeningDebt(accessToken, lease.id, {
        amount: Number(amount),
        paymentMethod: method,
        paidAt,
        notes: notes.trim() || undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      setOpen(false);
      setNotes("");
      // Depuis l'étape 42, ce règlement compte désormais dans le compte séquestre du propriétaire
      // (auparavant absent de ce total) — le dire explicitement, pas seulement « enregistré ».
      toast.success(`${formatFcfa(Number(amount))} réglés, ajoutés au compte séquestre du propriétaire.`);
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionTile tone="violet">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Impayés existants à l&apos;entrée</span>
        {remaining > 0 && !readOnly && (
          <Button variant="warning" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Fermer" : "Régler"}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
        <span className="text-body-sm text-ink-soft">Déclarée à l&apos;entrée : {formatFcfa(lease.openingDebtAmount)}</span>
        {remaining > 0 ? (
          <Badge variant="warning">Reste dû : {formatFcfa(remaining)}</Badge>
        ) : (
          <Badge variant="success">Soldée</Badge>
        )}
      </div>

      {open && remaining > 0 && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Montant réglé (FCFA)" htmlFor="openingDebtPaymentAmount" required hint={`Reste dû : ${formatFcfa(remaining)}`}>
            <Input
              id="openingDebtPaymentAmount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="openingDebtPaymentMethod" required>
              <select
                id="openingDebtPaymentMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de règlement" htmlFor="openingDebtPaidAt" required>
              <Input id="openingDebtPaidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="openingDebtNotes">
            <Input id="openingDebtNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer le règlement"}
          </Button>
        </form>
      )}

      {lease.openingDebtPayments && lease.openingDebtPayments.length > 0 && (
        <div className="flex flex-col gap-2">
          {lease.openingDebtPayments.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="font-label-sm text-ink">{p.paymentMethodLabel}</p>
                <p className="text-body-xs text-ink-muted">
                  Réglé le {p.paidAt}
                  {p.recordedBy && ` par ${p.recordedBy.name} (${p.recordedBy.roleLabel})`}
                  {p.notes && ` · ${p.notes}`}
                </p>
              </div>
              <span className="tabular font-currency-table text-body-sm text-success-fg">{formatFcfa(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionTile>
  );
}

/**
 * Historique des soldes figés à chaque clôture de mois (audit) — voir
 * `lease_balance_snapshots`. Purement informatif, jamais modifiable ; ne
 * s'affiche qu'une fois qu'au moins un mois a été clôturé depuis que ce
 * bail existe.
 */
