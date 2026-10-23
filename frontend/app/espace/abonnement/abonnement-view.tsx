"use client";

import * as React from "react";
import { FileDown } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  fetchCatalog, fetchSubscription, fetchQuote, startCheckout, listSubscriptionPayments, invoicePdfPath,
  requestRefund, listMyRefunds, offerLabel, PENDING_OFFER_KEY,
  type Catalog, type PlanKey, type Quote, type Refund, type Subscription, type SubscriptionPayment,
} from "@/lib/api/billing";
import { RequireAuth } from "@/components/auth/require-auth";
import { PlanCards } from "@/components/billing/plan-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

const REFUND_LABELS: Record<string, string> = {
  requested: "Demande en cours d'examen",
  approved: "Acceptée — consultez votre e-mail pour indiquer où recevoir le remboursement",
  details_received: "Coordonnées reçues — virement en préparation",
  processing: "Virement en cours",
  paid: "Remboursement envoyé",
  rejected: "Refusée",
  failed: "Virement en échec — nous le relançons",
};

export function AbonnementView() {
  return (
    <RequireAuth roles={["dg"]}>
      <AbonnementContent />
    </RequireAuth>
  );
}

function AbonnementContent() {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [sub, setSub] = React.useState<Subscription | null>(null);
  const [payments, setPayments] = React.useState<SubscriptionPayment[]>([]);
  const [refunds, setRefunds] = React.useState<Refund[]>([]);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [showRefund, setShowRefund] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([fetchCatalog(), fetchSubscription(accessToken), listSubscriptionPayments(accessToken), listMyRefunds(accessToken)])
      .then(([c, s, p, r]) => { setCatalog(c); setSub(s); setPayments(p.payments); setRefunds(r.refunds); })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Impossible de charger l'abonnement."));
  }, [accessToken, toast]);
  React.useEffect(() => load(), [load]);

  async function choose(plan: PlanKey, months: number) {
    if (!accessToken) return;
    setBusy(`${plan}:${months}`);
    try {
      setQuote(await fetchQuote(accessToken, plan, months));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Offre indisponible.");
    } finally {
      setBusy(null);
    }
  }

  // Offre pré-choisie sur la page Tarifs : on ouvre directement le récapitulatif de paiement (une seule fois).
  const preselected = React.useRef(false);
  React.useEffect(() => {
    if (preselected.current || !sub || sub.status !== "pending_payment") return;
    preselected.current = true;
    try {
      const raw = localStorage.getItem(PENDING_OFFER_KEY);
      localStorage.removeItem(PENDING_OFFER_KEY);
      const o = raw ? (JSON.parse(raw) as { plan: PlanKey; months: number }) : null;
      if (o && typeof o.months === "number") void choose(o.plan, o.months);
    } catch {}
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    if (!accessToken || !quote) return;
    setBusy("pay");
    try {
      const r = await startCheckout(accessToken, quote.planKey, quote.months);
      window.location.href = r.url; // page de paiement FedaPay (adresse vérifiée côté serveur)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Paiement indisponible.");
      setBusy(null);
    }
  }

  async function sendRefund() {
    if (!accessToken) return;
    setBusy("refund");
    try {
      await requestRefund(accessToken, reason);
      toast.success("Demande envoyée. Vous serez informé par e-mail.");
      setShowRefund(false);
      setReason("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Demande impossible.");
    } finally {
      setBusy(null);
    }
  }

  const refundOpen = sub?.refundOpen && refunds.length === 0;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-lg text-ink">
            {sub?.status === "pending_payment" ? "Bienvenue ! Choisissez votre offre" : "Abonnement"}
          </h1>
          <p className="text-body-md text-ink-soft">
            {sub?.status === "pending_payment"
              ? "Votre e-mail est confirmé. Choisissez une offre et réglez-la pour ouvrir votre espace ; un e-mail de confirmation vous sera envoyé."
              : "Votre offre, vos factures et la garantie de remboursement."}
          </p>
        </div>

        {sub && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{sub.planKey === "interne" ? "Compte interne" : sub.planLabel ? `Offre ${sub.planLabel}` : "Aucune offre active"}</CardTitle>
                <Badge variant={sub.active ? "success" : "danger"}>{sub.active ? "Actif" : sub.status === "refunded" ? "Remboursé" : "Inactif"}</Badge>
                {sub.founderPrice && <Badge variant="info">Tarif fondateur</Badge>}
              </div>
              <CardDescription>
                {sub.planKey === "interne"
                  ? "Votre entreprise dispose de toutes les fonctions, sans limite ni échéance."
                  : sub.currentPeriodEnd && sub.active
                    ? `Valable jusqu'au ${formatDateLabel(sub.currentPeriodEnd.slice(0, 10))}${sub.daysLeft !== null ? ` (${Math.max(0, sub.daysLeft)} jour(s) restant(s))` : ""}. Renouveler une même offre prolonge la période.`
                    : "Choisissez une offre ci-dessous pour accéder à votre espace. Vos locataires peuvent payer leurs loyers même sans abonnement actif."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {quote && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle>Confirmer votre achat</CardTitle>
              <CardDescription>
                Offre {catalog?.plans.find((p) => p.key === quote.planKey)?.label} — {offerLabel(quote.months)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="font-display text-headline-md text-ink">
                {formatFcfa(quote.price)}
                {quote.founder && <span className="ml-2 text-body-sm text-ink-faint line-through">{formatFcfa(quote.normalPrice)}</span>}
              </p>
              {quote.founder && <p className="text-body-sm text-success-fg">Tarif fondateur appliqué sur votre premier achat.</p>}
              {quote.isFirstPurchase && (
                <p className="text-body-sm text-ink-muted">Garantie : remboursement possible pendant {catalog?.refundWindowDays ?? 15} jours, frais du prestataire de paiement déduits.</p>
              )}
              <div className="flex gap-2">
                <Button onClick={pay} disabled={busy === "pay"}>{busy === "pay" ? "Redirection…" : "Payer avec Mobile Money / carte"}</Button>
                <Button variant="ghost" onClick={() => setQuote(null)} disabled={busy === "pay"}>Annuler</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {catalog && sub?.planKey !== "interne" && (
          <PlanCards catalog={catalog} onChoose={choose} busyKey={busy} currentPlan={sub?.active ? sub.planKey : null} />
        )}

        {refundOpen && (
          <Card>
            <CardHeader>
              <CardTitle>Garantie de remboursement</CardTitle>
              <CardDescription>
                Pas satisfait ? Demandez le remboursement jusqu&apos;au {sub?.refundEligibleUntil ? formatDateLabel(sub.refundEligibleUntil.slice(0, 10)) : "—"}. Notre équipe examine votre raison ; les frais du prestataire de paiement sont déduits.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {showRefund ? (
                <>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    placeholder="Dites-nous pourquoi l'offre ne vous convient pas…"
                    className="w-full rounded border border-border-strong bg-surface p-3 text-body-md text-ink"
                  />
                  <div className="flex gap-2">
                    <Button onClick={sendRefund} disabled={busy === "refund" || reason.trim().length < 10}>Envoyer la demande</Button>
                    <Button variant="ghost" onClick={() => setShowRefund(false)}>Annuler</Button>
                  </div>
                </>
              ) : (
                <Button variant="secondary" className="self-start" onClick={() => setShowRefund(true)}>Demander un remboursement</Button>
              )}
            </CardContent>
          </Card>
        )}

        {refunds.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Ma demande de remboursement</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1">
              {refunds.map((r) => (
                <div key={r.id} className="text-body-sm text-ink-soft">
                  <span className="font-label-md text-ink">{REFUND_LABELS[r.status] ?? r.status}</span>
                  {r.refundAmount !== null && ` — ${formatFcfa(r.refundAmount)} à recevoir`}
                  {r.status === "rejected" && r.adminNote ? ` — Motif : ${r.adminNote}` : ""}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {payments.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Factures</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facture</TableHead>
                    <TableHead>Offre</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.invoiceNumber ?? "—"}</TableCell>
                      <TableCell>{p.planLabel} · {offerLabel(p.months)}{p.status === "refunded" ? " (remboursé)" : ""}</TableCell>
                      <TableCell>{p.paidAt ? formatDateLabel(p.paidAt.slice(0, 10)) : "—"}</TableCell>
                      <TableCell>{formatFcfa(p.amount)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => accessToken && openAuthenticatedPdf(invoicePdfPath(p.id), accessToken)}>
                          <FileDown size={14} /> PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
