"use client";

import * as React from "react";
import Link from "next/link";
import { FileDown, Send, ShieldCheck, Trash2, Banknote } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  HISTORY_KIND_LABELS,
  getPaymentHistory,
  getPaymentSummary,
  verifyPaymentAudit,
  type HistoryItem,
  type HistoryKind,
  type PaymentHistory,
  type PaymentSummary,
} from "@/lib/api/payments";
import { deletePayslip, listStaff, updateBaseSalary, type StaffMember } from "@/lib/api/payslips";
import { listOwners, type OwnerListItem } from "@/lib/api/owners";
import { RequireAuth } from "@/components/auth/require-auth";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { NewPaymentForm } from "./new-payment-form";
import { OrderDetail } from "./order-detail";

/**
 * Menu unique « Paiements » (salaires + reversements + dépenses + restitutions) :
 *  - FedaPay ACTIF → salaires et reversements propriétaires obligatoirement par FedaPay (le serveur refuse la saisie libre) ;
 *  - FedaPay INACTIF → saisie du paiement effectué, avec récapitulatif et confirmation.
 * Chaque opération est tracée dans l'historique avec son reçu.
 */
export function PaiementsView() {
  return (
    <RequireAuth roles={["dg", "comptable"]}>
      <PaiementsContent />
    </RequireAuth>
  );
}

type Tab = "historique" | "personnel";

const METHOD_LABELS: Record<HistoryItem["method"], string> = { especes: "Espèces", mobile_money: "Mobile Money", virement: "Virement", cheque: "Chèque" };
const STATUS_LABELS: Record<HistoryItem["status"], { label: string; variant: "success" | "warning" | "danger" }> = {
  paid: { label: "Payé", variant: "success" },
  processing: { label: "En cours", variant: "warning" },
  failed: { label: "Échoué", variant: "danger" },
  to_regularize: { label: "À régulariser", variant: "danger" },
};

function PaiementsContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const toast = useToast();
  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [history, setHistory] = React.useState<PaymentHistory | null>(null);
  const [staff, setStaff] = React.useState<StaffMember[]>([]);
  const [owners, setOwners] = React.useState<OwnerListItem[]>([]);
  const [tab, setTab] = React.useState<Tab>("historique");
  const [kind, setKind] = React.useState<HistoryKind | "">("");
  const [month, setMonth] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = React.useState<number | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [presetUser, setPresetUser] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    const range = month ? { from: `${month}-01`, to: `${month}-31` } : {};
    Promise.all([getPaymentSummary(accessToken), getPaymentHistory(accessToken, { kind: kind || undefined, ...range })])
      .then(([s, h]) => {
        setSummary(s);
        setHistory(h);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les paiements."));
    if (isDg) listStaff(accessToken).then((r) => setStaff(r.staff)).catch(() => undefined);
    listOwners(accessToken).then((r) => setOwners(r.owners)).catch(() => undefined);
  }, [accessToken, kind, month, isDg]);
  React.useEffect(() => load(), [load]);

  // Les ordres FedaPay « en cours » sont relus régulièrement (le serveur interroge FedaPay).
  const hasPending = history?.items.some((i) => i.status === "processing") ?? false;
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

  const fedapay = !!summary?.enabled;
  const kinds = Object.keys(HISTORY_KIND_LABELS) as HistoryKind[];

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Paiements</h1>
            <p className="text-body-md text-ink-soft">
              Salaires, reversements aux propriétaires, dépenses et restitutions de caution — chaque opération est tracée avec son reçu.
            </p>
          </div>
          <div className="flex gap-2">
            {isDg && fedapay && (
              <Button variant="secondary" onClick={checkAudit}>
                <ShieldCheck size={16} /> Vérifier le journal
              </Button>
            )}
            {isDg && summary && (
              <Button onClick={() => { setPresetUser(null); setShowForm((v) => !v); }}>
                <Send size={16} /> Nouveau paiement
              </Button>
            )}
          </div>
        </div>

        {error && <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>}

        {summary && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-body-sm text-ink-soft">
            <Badge variant={fedapay ? "success" : "neutral"}>{fedapay ? "FedaPay activé" : "Saisie manuelle"}</Badge>
            {fedapay ? (
              <>
                <span>Les salaires et les reversements aux propriétaires sont envoyés par FedaPay (Mobile Money).</span>
                {summary.sandbox && <Badge variant="warning">Mode test — aucun vrai argent</Badge>}
                <span>Plafond par paiement : {formatFcfa(summary.perOrderLimit)}</span>
                <span>Aujourd&apos;hui : {formatFcfa(summary.sentToday)} / {formatFcfa(summary.dailyLimit)}</span>
              </>
            ) : (
              <span>
                Vous enregistrez les paiements déjà effectués ; un récapitulatif est demandé avant chaque enregistrement. Pour payer directement en
                Mobile Money, le directeur général peut activer FedaPay dans{" "}
                <Link className="text-primary hover:underline" href="/espace/parametres">Paramètres</Link>.
              </span>
            )}
          </div>
        )}

        {showForm && isDg && summary && (
          <NewPaymentForm
            accessToken={accessToken}
            fedapay={fedapay}
            isDg={isDg}
            staff={staff}
            owners={owners}
            presetUserId={presetUser}
            onCancel={() => setShowForm(false)}
            onDone={(order) => {
              setShowForm(false);
              if (order) setSelectedOrder(order.id);
              setTab("historique");
              load();
            }}
          />
        )}

        {selectedOrder !== null && (
          <OrderDetail id={selectedOrder} accessToken={accessToken} isDg={isDg} onClose={() => setSelectedOrder(null)} onChanged={load} />
        )}

        {history && (
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total sorti (période)" value={formatFcfa(history.total)} unit="FCFA" />
            {kinds
              .filter((k) => isDg || k !== "salaire")
              .slice(0, 3)
              .map((k) => (
                <StatCard key={k} label={HISTORY_KIND_LABELS[k]} value={formatFcfa(history.byKind[k] ?? 0)} unit="FCFA" onClick={() => { setKind(k); setTab("historique"); }} />
              ))}
          </div>
        )}

        <div className="flex gap-1 border-b border-border">
          {([["historique", "Historique"], ...(isDg ? [["personnel", "Personnel & salaires"]] : [])] as [Tab, string][]).map(([t, l]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-label-md transition-colors ${tab === t ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {tab === "historique" && (
          <HistoryTable
            history={history}
            kind={kind}
            month={month}
            isDg={isDg}
            accessToken={accessToken}
            onKind={setKind}
            onMonth={setMonth}
            onOrder={setSelectedOrder}
            onChanged={load}
            kinds={kinds.filter((k) => isDg || k !== "salaire")}
          />
        )}

        {tab === "personnel" && isDg && (
          <StaffCard
            staff={staff}
            accessToken={accessToken}
            onChanged={load}
            onPay={(id) => { setPresetUser(id); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          />
        )}
      </div>
    </div>
  );
}

function HistoryTable({
  history, kind, month, isDg, accessToken, onKind, onMonth, onOrder, onChanged, kinds,
}: {
  history: PaymentHistory | null;
  kind: HistoryKind | "";
  month: string;
  isDg: boolean;
  accessToken: string | null;
  onKind: (k: HistoryKind | "") => void;
  onMonth: (m: string) => void;
  onOrder: (id: number) => void;
  onChanged: () => void;
  kinds: HistoryKind[];
}) {
  const toast = useToast();
  const [cancelling, setCancelling] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");

  async function openReceipt(item: HistoryItem) {
    if (!accessToken || !item.receiptUrl) return;
    try {
      await openAuthenticatedPdf(item.receiptUrl, accessToken);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Téléchargement impossible.");
    }
  }

  async function cancelPayslip(id: number) {
    if (!accessToken) return;
    try {
      await deletePayslip(accessToken, id, reason.trim());
      toast.success("Fiche de paie annulée.");
      setCancelling(null);
      setReason("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'annuler cette fiche.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Historique des opérations</CardTitle>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Type d'opération" value={kind} onChange={(e) => onKind(e.target.value as HistoryKind | "")} className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink">
              <option value="">Toutes les opérations</option>
              {kinds.map((k) => (<option key={k} value={k}>{HISTORY_KIND_LABELS[k]}</option>))}
            </select>
            <Input aria-label="Mois" type="month" value={month} onChange={(e) => onMonth(e.target.value)} className="w-40" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!history ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : history.items.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune opération pour ces critères.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Opération</TableHead>
                <TableHead>Bénéficiaire</TableHead>
                <TableHead>Règlement</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.items.map((i) => {
                const st = STATUS_LABELS[i.status];
                const rowKey = `${i.kind}-${i.id}-${i.reference ?? ""}`;
                return (
                  <TableRow key={rowKey} className={i.kind === "restitution_caution" ? "bg-danger-bg [&>td]:!text-danger-fg [&_.text-ink-muted]:!text-danger-fg/80" : undefined}>
                    <TableCell>{new Date(i.date).toLocaleDateString("fr-FR")}</TableCell>
                    <TableCell>
                      {HISTORY_KIND_LABELS[i.kind]}
                      <div className="text-body-xs text-ink-muted">{i.label}</div>
                    </TableCell>
                    <TableCell>{i.beneficiary ?? "—"}</TableCell>
                    <TableCell>
                      {i.channel === "fedapay" ? <Badge variant="info">FedaPay</Badge> : METHOD_LABELS[i.method]}
                      {i.reference && <div className="text-body-xs text-ink-muted">{i.reference}</div>}
                    </TableCell>
                    <TableAmount>{formatFcfa(i.amount)}</TableAmount>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {i.failureReason && <div className="mt-1 text-body-xs text-danger">{i.failureReason}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {i.receiptUrl && (
                          <Button size="sm" variant="ghost" aria-label="Télécharger le reçu" onClick={() => openReceipt(i)}>
                            <FileDown size={14} /> Reçu
                          </Button>
                        )}
                        {i.orderId && (
                          <Button size="sm" variant="ghost" onClick={() => onOrder(i.orderId!)}>Détail</Button>
                        )}
                        {isDg && i.kind === "salaire" && i.status === "paid" && i.channel !== "fedapay" && (
                          cancelling === i.id ? (
                            <>
                              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (5 car. min.)" className="w-40" />
                              <Button size="sm" variant="destructive" disabled={reason.trim().length < 5} onClick={() => cancelPayslip(i.id)}>Confirmer</Button>
                              <Button size="sm" variant="ghost" onClick={() => setCancelling(null)}>Non</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" aria-label="Annuler cette fiche de paie" onClick={() => setCancelling(i.id)}>
                              <Trash2 size={14} className="text-danger-fg" />
                            </Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function StaffCard({ staff, accessToken, onChanged, onPay }: { staff: StaffMember[]; accessToken: string | null; onChanged: () => void; onPay: (id: number) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personnel</CardTitle>
        <CardDescription>Salaire de base et compte Mobile Money mémorisés par employé — proposés à chaque paiement, ajustables avant validation.</CardDescription>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucun compte actif.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Salaire de base</TableHead>
                <TableHead>Mobile Money</TableHead>
                <TableHead>Dernière fiche</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (<StaffRow key={s.id} staff={s} accessToken={accessToken} onChanged={onChanged} onPay={() => onPay(s.id)} />))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function StaffRow({ staff, accessToken, onChanged, onPay }: { staff: StaffMember; accessToken: string | null; onChanged: () => void; onPay: () => void }) {
  const initial = staff.baseSalary != null ? String(staff.baseSalary) : "";
  const [value, setValue] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const toast = useToast();

  async function save() {
    if (!accessToken) return;
    setSaving(true);
    try {
      await updateBaseSalary(accessToken, staff.id, value ? Number(value) : null);
      toast.success("Salaire de base mis à jour.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce salaire de base.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell><p className="font-label-md text-ink">{staff.firstName} {staff.lastName}</p></TableCell>
      <TableCell><Badge variant={staff.role === "dg" ? "info" : "neutral"}>{staff.roleLabel}</Badge></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} placeholder="Non défini" className="w-32" />
          {value !== initial && (<Button size="sm" onClick={save} disabled={saving}>{saving ? "…" : "OK"}</Button>)}
        </div>
      </TableCell>
      <TableCell>
        {staff.momoPhoneMasked ? (
          <span className="tabular text-body-sm text-ink-soft">{staff.momoOperator?.toUpperCase()} {staff.momoPhoneMasked}</span>
        ) : (
          <span className="text-body-sm text-ink-muted">Non enregistré</span>
        )}
      </TableCell>
      <TableCell>
        {staff.lastPayslip ? (
          <span className="text-body-sm text-ink-soft">{staff.lastPayslip.period} — {formatFcfa(staff.lastPayslip.netAmount)}</span>
        ) : (
          <span className="text-body-sm text-ink-muted">Aucune</span>
        )}
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={onPay}><Banknote size={14} /> Payer le salaire</Button>
      </TableCell>
    </TableRow>
  );
}
