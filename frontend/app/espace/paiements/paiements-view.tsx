"use client";

import * as React from "react";
import Link from "next/link";
import { FileDown, RefreshCw, ShieldCheck, Send } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  PAYMENT_PURPOSE_LABELS,
  PAYMENT_STATUS_LABELS,
  createPaymentOrder,
  getPaymentOrder,
  getPaymentSummary,
  listPaymentOrders,
  paymentAdvicePdfPath,
  refreshPaymentOrder,
  retryApplyPaymentOrder,
  verifyPaymentAudit,
  type CreatePaymentInput,
  type PaymentOperator,
  type PaymentOrder,
  type PaymentPurpose,
  type PaymentStatus,
  type PaymentSummary,
  type PaymentTimelineEvent,
} from "@/lib/api/payments";
import { listStaff, type StaffMember } from "@/lib/api/payslips";
import { listOwners, type OwnerListItem } from "@/lib/api/owners";
import { RequireAuth } from "@/components/auth/require-auth";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Paiements sortants (FedaPay) : salaires, reversements aux propriétaires, autres paiements.
 * Lecture : DG et comptable. Envoi : DG uniquement, avec re-saisie du mot de passe (le serveur refuse sinon).
 * Le statut affiché vient toujours du serveur, qui relit FedaPay ; rien n'est considéré payé côté navigateur.
 */
export function PaiementsView() {
  return (
    <RequireAuth roles={["dg", "comptable"]}>
      <PaiementsContent />
    </RequireAuth>
  );
}

const EVENT_LABELS: Record<string, string> = {
  order_created: "Ordre créé",
  reauth_failed: "Mot de passe refusé",
  provider_created: "Transmis au prestataire",
  provider_started: "Envoi lancé",
  provider_error: "Erreur du prestataire",
  provider_confirmed: "Envoi confirmé par le prestataire",
  provider_failed: "Échec signalé par le prestataire",
  anomaly_amount: "Anomalie : montant divergent",
  applied: "Enregistré en comptabilité",
  apply_blocked: "À régulariser manuellement",
};

function statusVariant(s: PaymentStatus): "success" | "warning" | "danger" | "neutral" {
  return s === "sent" ? "success" : s === "failed" ? "danger" : s === "processing" ? "warning" : "neutral";
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function PaiementsContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const toast = useToast();
  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [orders, setOrders] = React.useState<PaymentOrder[] | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<PaymentStatus | "">("");
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([getPaymentSummary(accessToken), listPaymentOrders(accessToken, { status: statusFilter || undefined })])
      .then(([s, o]) => {
        setSummary(s);
        setOrders(o.orders);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les paiements."));
  }, [accessToken, statusFilter]);

  React.useEffect(() => load(), [load]);

  // Les ordres « en cours » sont relus régulièrement (le serveur interroge FedaPay).
  const hasPending = orders?.some((o) => o.status === "processing") ?? false;
  React.useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [hasPending, load]);

  async function checkAudit() {
    if (!accessToken) return;
    try {
      const r = await verifyPaymentAudit(accessToken);
      if (r.ok) toast.success(`Journal intègre (${r.count} événements vérifiés).`);
      else setError(`Journal ALTÉRÉ à partir de l'événement n° ${r.brokenAtId}. Contactez le support immédiatement.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Vérification impossible.");
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Paiements</h1>
            <p className="text-body-md text-ink-soft">
              Envoyez des salaires, reversez les loyers aux propriétaires ou réglez une dépense en Mobile Money — chaque opération est tracée.
            </p>
          </div>
          <div className="flex gap-2">
            {isDg && (
              <Button variant="secondary" onClick={checkAudit}>
                <ShieldCheck size={16} /> Vérifier le journal
              </Button>
            )}
            {isDg && summary?.enabled && (
              <Button onClick={() => setShowForm((v) => !v)}>
                <Send size={16} /> Nouveau paiement
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
        )}

        {summary && !summary.enabled && (
          <Card>
            <CardContent className="py-5 text-body-sm text-ink-soft">
              Les paiements sortants ne sont pas activés. Le directeur général peut les activer dans{" "}
              <Link className="text-primary hover:underline" href="/espace/parametres">
                Paramètres
              </Link>{" "}
              (clé FedaPay et plafonds). Tant qu&apos;ils sont désactivés, les paiements s&apos;enregistrent à la main comme avant.
            </CardContent>
          </Card>
        )}

        {summary?.enabled && (
          <div className="flex flex-wrap items-center gap-3 text-body-sm text-ink-soft">
            {summary.sandbox && <Badge variant="warning">Mode test — aucun vrai argent</Badge>}
            <span>Plafond par paiement : {formatFcfa(summary.perOrderLimit)}</span>
            <span>
              Aujourd&apos;hui : {formatFcfa(summary.sentToday)} / {formatFcfa(summary.dailyLimit)}
            </span>
          </div>
        )}

        {showForm && isDg && summary?.enabled && (
          <NewPaymentForm
            accessToken={accessToken}
            onCreated={(o) => {
              setShowForm(false);
              setSelected(o.id);
              load();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Historique</CardTitle>
              <select
                aria-label="Filtrer par statut"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | "")}
                className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              >
                <option value="">Tous les statuts</option>
                {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PAYMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {!orders ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : orders.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun paiement pour l&apos;instant.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Bénéficiaire</TableHead>
                    <TableHead>Objet</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{formatDateTime(o.createdAt)}</TableCell>
                      <TableCell>
                        {o.beneficiaryName}
                        <div className="text-body-xs text-ink-muted">{o.beneficiaryPhoneMasked}</div>
                      </TableCell>
                      <TableCell>{PAYMENT_PURPOSE_LABELS[o.purpose]}</TableCell>
                      <TableAmount>{formatFcfa(o.amount)}</TableAmount>
                      <TableCell>
                        <Badge variant={statusVariant(o.status)}>{PAYMENT_STATUS_LABELS[o.status]}</Badge>
                        {o.status === "sent" && !o.applied && (
                          <div className="mt-1 text-body-xs text-danger">À régulariser</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(o.id)}>
                          Détail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selected !== null && (
          <OrderDetail
            id={selected}
            accessToken={accessToken}
            isDg={isDg}
            onClose={() => setSelected(null)}
            onChanged={load}
          />
        )}
      </div>
    </div>
  );
}

function NewPaymentForm({
  accessToken,
  onCreated,
  onCancel,
}: {
  accessToken: string | null;
  onCreated: (o: PaymentOrder) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const { key: idempotencyKey, renew } = useIdempotencyKey();
  const [purpose, setPurpose] = React.useState<PaymentPurpose>("autre");
  const [staff, setStaff] = React.useState<StaffMember[]>([]);
  const [owners, setOwners] = React.useState<OwnerListItem[]>([]);
  const [userId, setUserId] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [period, setPeriod] = React.useState(new Date().toISOString().slice(0, 7));
  const [baseAmount, setBaseAmount] = React.useState("");
  const [bonusAmount, setBonusAmount] = React.useState("");
  const [deductionAmount, setDeductionAmount] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [periodLabel, setPeriodLabel] = React.useState("");
  const [beneficiaryName, setBeneficiaryName] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [operator, setOperator] = React.useState<PaymentOperator>("mtn");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listStaff(accessToken).then((r) => setStaff(r.staff)).catch(() => undefined);
    listOwners(accessToken).then((r) => setOwners(r.owners)).catch(() => undefined);
  }, [accessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    const common = { phone: phone.trim(), operator, password, idempotencyKey };
    let input: CreatePaymentInput;
    if (purpose === "salaire") {
      if (!userId) return setError("Choisissez l'employé.");
      input = {
        purpose,
        userId: Number(userId),
        period,
        baseAmount: Number(baseAmount) || 0,
        bonusAmount: Number(bonusAmount) || undefined,
        deductionAmount: Number(deductionAmount) || undefined,
        ...common,
      };
    } else if (purpose === "reversement_proprietaire") {
      if (!ownerId) return setError("Choisissez le propriétaire.");
      input = { purpose, ownerId: Number(ownerId), amount: Number(amount) || 0, periodLabel: periodLabel.trim(), ...common };
    } else {
      input = { purpose, beneficiaryName: beneficiaryName.trim(), amount: Number(amount) || 0, label: label.trim(), ...common };
    }
    setSubmitting(true);
    try {
      const res = await createPaymentOrder(accessToken, input);
      toast.success(res.replayed ? "Ce paiement existait déjà." : "Paiement transmis — en attente de confirmation.");
      setPassword("");
      renew();
      onCreated(res.order);
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer ce paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectCls = "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau paiement</CardTitle>
        <CardDescription>Vérifiez soigneusement le numéro : un envoi Mobile Money ne s&apos;annule pas.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
          {error && (
            <div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          <Field label="Objet" htmlFor="pay-purpose">
            <select id="pay-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as PaymentPurpose)} className={selectCls}>
              {(Object.keys(PAYMENT_PURPOSE_LABELS) as PaymentPurpose[]).map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_PURPOSE_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>

          {purpose === "salaire" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Employé" htmlFor="pay-user" required>
                <select id="pay-user" value={userId} onChange={(e) => setUserId(e.target.value)} className={selectCls}>
                  <option value="">—</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Période" htmlFor="pay-period" required>
                <Input id="pay-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </Field>
              <Field label="Salaire de base (FCFA)" htmlFor="pay-base" required>
                <Input id="pay-base" inputMode="numeric" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Prime (FCFA)" htmlFor="pay-bonus">
                <Input id="pay-bonus" inputMode="numeric" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Retenue (FCFA)" htmlFor="pay-deduction">
                <Input id="pay-deduction" inputMode="numeric" value={deductionAmount} onChange={(e) => setDeductionAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
          )}

          {purpose === "reversement_proprietaire" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Propriétaire" htmlFor="pay-owner" required>
                <select id="pay-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectCls}>
                  <option value="">—</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Montant (FCFA)" htmlFor="pay-amount" required hint="Ne peut pas dépasser le solde dû au propriétaire.">
                <Input id="pay-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Période concernée" htmlFor="pay-period-label" required>
                <Input id="pay-period-label" value={periodLabel} maxLength={50} placeholder="Octobre 2026" onChange={(e) => setPeriodLabel(e.target.value)} />
              </Field>
            </div>
          )}

          {purpose === "autre" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Bénéficiaire" htmlFor="pay-name" required>
                <Input id="pay-name" value={beneficiaryName} maxLength={100} onChange={(e) => setBeneficiaryName(e.target.value)} />
              </Field>
              <Field label="Montant (FCFA)" htmlFor="pay-amount-o" required>
                <Input id="pay-amount-o" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Motif" htmlFor="pay-label" required>
                <Input id="pay-label" value={label} maxLength={190} onChange={(e) => setLabel(e.target.value)} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Numéro Mobile Money" htmlFor="pay-phone" required>
              <Input id="pay-phone" inputMode="tel" value={phone} maxLength={20} placeholder="01 97 00 11 22" onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Opérateur" htmlFor="pay-operator" required>
              <select id="pay-operator" value={operator} onChange={(e) => setOperator(e.target.value as PaymentOperator)} className={selectCls}>
                <option value="mtn">MTN</option>
                <option value="moov">Moov</option>
              </select>
            </Field>
            <Field label="Votre mot de passe" htmlFor="pay-password" required hint="Demandé à chaque envoi d'argent.">
              <Input id="pay-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting || !password}>
              {submitting ? "Envoi…" : "Envoyer le paiement"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function OrderDetail({
  id,
  accessToken,
  isDg,
  onClose,
  onChanged,
}: {
  id: number;
  accessToken: string | null;
  isDg: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = React.useState<{ order: PaymentOrder; timeline: PaymentTimelineEvent[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getPaymentOrder(accessToken, id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger ce paiement."));
  }, [accessToken, id]);
  React.useEffect(() => load(), [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }

  const o = data?.order;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Paiement {o?.reference ?? ""}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>}
        {!o ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
              <div><dt className="text-ink-muted">Bénéficiaire</dt><dd className="text-ink">{o.beneficiaryName} — {o.beneficiaryPhoneMasked} ({o.operator.toUpperCase()})</dd></div>
              <div><dt className="text-ink-muted">Montant</dt><dd className="text-ink">{formatFcfa(o.amount)}</dd></div>
              <div><dt className="text-ink-muted">Motif</dt><dd className="text-ink">{o.label}</dd></div>
              <div><dt className="text-ink-muted">Statut</dt><dd><Badge variant={statusVariant(o.status)}>{PAYMENT_STATUS_LABELS[o.status]}</Badge></dd></div>
            </dl>
            {o.failureReason && (
              <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-sm text-warning-fg">{o.failureReason}</p>
            )}
            <ol className="flex flex-col gap-1.5 border-l border-border pl-4 text-body-sm">
              {data.timeline.map((ev) => (
                <li key={ev.id}>
                  <span className="text-ink">{EVENT_LABELS[ev.event] ?? ev.event}</span>{" "}
                  <span className="text-ink-muted">· {formatDateTime(ev.at)}</span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {o.status === "processing" && accessToken && (
                <Button variant="secondary" disabled={busy} onClick={() => run(() => refreshPaymentOrder(accessToken, o.id))}>
                  <RefreshCw size={16} /> Actualiser le statut
                </Button>
              )}
              {o.status === "sent" && !o.applied && isDg && accessToken && (
                <Button variant="secondary" disabled={busy} onClick={() => run(() => retryApplyPaymentOrder(accessToken, o.id))}>
                  Réessayer l&apos;enregistrement comptable
                </Button>
              )}
              {o.status === "sent" && accessToken && (
                <Button
                  variant="secondary"
                  onClick={() => openAuthenticatedPdf(paymentAdvicePdfPath(o.id), accessToken).catch((err) => setError(err instanceof ApiError ? err.message : "Téléchargement impossible."))}
                >
                  <FileDown size={16} /> Avis de paiement (PDF)
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
