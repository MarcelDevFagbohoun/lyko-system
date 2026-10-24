"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, FileDown, Minus } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  fetchCatalog, fetchSubscription, fetchQuote, fetchUpgradeOptions, startCheckout, listSubscriptionPayments, invoicePdfPath,
  listMyRefunds, offerLabel, limitLabel, FEATURE_LABELS, PENDING_OFFER_KEY,
  type Catalog, type PlanKey, type Quote, type Refund, type Subscription, type SubscriptionPayment, type UpgradeOption,
} from "@/lib/api/billing";
import { RequireAuth } from "@/components/auth/require-auth";
import { PlanCards } from "@/components/billing/plan-cards";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

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
  const [upgrades, setUpgrades] = React.useState<UpgradeOption[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Seuls le catalogue et l'abonnement sont indispensables : l'historique, les demandes d'annulation et les offres
  // supérieures échouent seuls sans vider la page. Une erreur s'affiche dans la page (avec « Réessayer »), jamais en rafale
  // de messages, et ne relance rien automatiquement.
  const load = React.useCallback(() => {
    if (!accessToken) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetchCatalog(),
      fetchSubscription(accessToken),
      listSubscriptionPayments(accessToken).catch(() => ({ payments: [] as SubscriptionPayment[] })),
      listMyRefunds(accessToken).catch(() => ({ refunds: [] as Refund[] })),
    ])
      .then(async ([c, s, p, r]) => {
        setCatalog(c);
        setSub(s);
        setPayments(p.payments);
        setRefunds(r.refunds);
        const u = s.active ? await fetchUpgradeOptions(accessToken).catch(() => ({ options: [] as UpgradeOption[] })) : { options: [] as UpgradeOption[] };
        setUpgrades(u.options);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Impossible de charger l'abonnement."))
      .finally(() => setLoading(false));
  }, [accessToken]);
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

  const noPlan = !!sub && !sub.active && sub.planKey !== "interne";
  const currentPlan = sub?.active && sub.planKey !== "interne" ? catalog?.plans.find((p) => p.key === sub.planKey) ?? null : null;
  const reviewing = refunds.some((r) => ["requested", "approved", "details_received", "processing", "failed"].includes(r.status));
  const lastRejected = refunds.find((r) => r.status === "rejected");
  const FEATURE_ORDER = ["core", "tenant_collect", "payroll", "payouts", "owner_portal", "sale_properties", "advanced_accounting", "audit_full"];

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-lg text-ink">
            {sub?.status === "pending_payment" ? "Bienvenue ! Choisissez votre offre" : "Abonnement"}
          </h1>
          <p className="text-body-md text-ink-soft">
            {sub?.status === "pending_payment"
              ? "Votre e-mail est confirmé. Choisissez une offre et réglez-la pour ouvrir votre espace. Vous recevrez ensuite votre reçu par e-mail."
              : noPlan
                ? "Votre abonnement n'est pas actif. Choisissez une offre pour retrouver l'accès à votre espace."
                : "Votre offre en cours, vos paiements et vos reçus."}
          </p>
        </div>

        {loadError && !sub && (
          <Card>
            <CardHeader>
              <CardTitle>Impossible d&apos;afficher votre abonnement</CardTitle>
              <CardDescription>
                Le service d&apos;abonnement ne répond pas pour le moment. Votre espace et vos données ne sont pas affectés. Réessayez dans un instant ;
                si le problème continue, écrivez-nous.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={load} disabled={loading}>{loading ? "Chargement…" : "Réessayer"}</Button>
            </CardContent>
          </Card>
        )}

        {sub?.planKey === "interne" && (
          <Card>
            <CardHeader>
              <CardTitle>Compte interne</CardTitle>
              <CardDescription>Votre entreprise dispose de toutes les fonctions, sans limite ni échéance.</CardDescription>
            </CardHeader>
          </Card>
        )}

        {currentPlan && sub && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Offre {currentPlan.label}</CardTitle>
                <Badge variant="success">Actif</Badge>
                {sub.founderPrice && <Badge variant="info">Tarif fondateur</Badge>}
              </div>
              <CardDescription>
                {sub.currentPeriodEnd ? `Valable jusqu'au ${formatDateLabel(sub.currentPeriodEnd.slice(0, 10))}` : ""}
                {sub.daysLeft !== null ? ` (${Math.max(0, sub.daysLeft)} jour${sub.daysLeft > 1 ? "s" : ""} restant${sub.daysLeft > 1 ? "s" : ""})` : ""}
                {sub.periodMonths ? `, dernière période : ${offerLabel(sub.periodMonths)}` : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ul className="flex flex-col gap-1.5 text-body-sm text-ink-soft">
                <li className="font-label-md text-ink">
                  {limitLabel(currentPlan.limits.units)} unités · {limitLabel(currentPlan.limits.owners)} propriétaires · {limitLabel(currentPlan.limits.users)} utilisateurs
                </li>
                {FEATURE_ORDER.filter((k) => currentPlan.features.includes(k)).map((k) => (
                  <li key={k} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-success-fg" />{FEATURE_LABELS[k]}</li>
                ))}
                <li className="flex gap-2 text-ink-faint">
                  <Minus size={14} className="mt-1 shrink-0" />
                  <span>{FEATURE_LABELS.ai_assistant} <Badge variant="neutral">Bientôt disponible</Badge></span>
                </li>
              </ul>
              <div className="flex flex-col gap-2">
                <p className="font-label-md text-ink">Renouveler</p>
                <p className="text-body-sm text-ink-muted">Le renouvellement commence à la fin de votre période actuelle, sans interruption de votre activité.</p>
                <div className="flex flex-wrap gap-2">
                  {currentPlan.offers.map((o) => (
                    <Button key={o.months} variant="secondary" disabled={!!busy} onClick={() => choose(currentPlan.key, o.months)}>
                      {busy === `${currentPlan.key}:${o.months}` ? "Un instant…" : `${offerLabel(o.months)} · ${formatFcfa(o.price)}`}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                {reviewing ? (
                  <>
                    <Button variant="secondary" className="self-start" disabled>Examen en cours</Button>
                    <p className="text-body-sm text-ink-muted">Votre demande d&apos;annulation est en cours d&apos;examen. Nous vous répondons par e-mail.</p>
                  </>
                ) : (
                  <>
                    <Link href="/espace/abonnement/annulation" className={buttonVariants({ variant: "ghost" }) + " self-start"}>Demander l&apos;annulation</Link>
                    {lastRejected && (
                      <p className="text-body-sm text-ink-muted">Votre dernière demande n&apos;a pas été acceptée{lastRejected.adminNote ? ` : ${lastRejected.adminNote}` : "."} Vous pouvez en faire une nouvelle.</p>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {sub?.lastFailure && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger-border bg-danger-bg p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger-fg" />
              <div>
                <p className="font-label-md text-danger-fg">
                  {sub.lastFailure.anomaly ? "Un paiement est en cours de vérification par notre équipe" : sub.lastFailure.reason === "incomplete" ? "Votre dernier paiement n'a pas été terminé" : "Votre dernier paiement n'a pas abouti"}
                </p>
                <p className="text-body-sm text-ink-soft">
                  {formatFcfa(sub.lastFailure.amount)} · {catalog?.plans.find((p) => p.key === sub.lastFailure!.planKey)?.label} · {offerLabel(sub.lastFailure.months)}.
                  {sub.lastFailure.anomaly ? " Nous vous répondons rapidement." : " Rien n'a été activé. Si votre compte a été débité, écrivez-nous avec la référence :"}
                  {!sub.lastFailure.anomaly && <span className="ml-1 break-all font-mono text-body-xs">{sub.lastFailure.reference}</span>}
                </p>
              </div>
            </div>
            {!sub.lastFailure.anomaly && (
              <Button variant="secondary" className="shrink-0" disabled={!!busy} onClick={() => choose(sub.lastFailure!.planKey, sub.lastFailure!.months)}>
                Réessayer
              </Button>
            )}
          </div>
        )}

        {currentPlan && upgrades.length > 0 && !reviewing && (
          <Card>
            <CardHeader>
              <CardTitle>Passer à une offre supérieure</CardTitle>
              <CardDescription>Les jours qu&apos;il vous reste sur votre abonnement sont déduits du prix. La nouvelle offre démarre tout de suite.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {upgrades.map((o) => (
                <div key={`${o.planKey}:${o.months}`} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                  <p className="font-label-md text-ink">{catalog?.plans.find((p) => p.key === o.planKey)?.label}, {offerLabel(o.months)}</p>
                  <p className="text-body-sm text-ink-muted">
                    Prix {formatFcfa(o.fullPrice)} − crédit {formatFcfa(o.credit)} ({o.creditDays} jour{o.creditDays > 1 ? "s" : ""} restants)
                  </p>
                  <p className="font-display text-headline-md text-ink">{formatFcfa(o.price)}</p>
                  <Button variant="primary" disabled={!!busy} onClick={() => choose(o.planKey, o.months)}>
                    {busy === `${o.planKey}:${o.months}` ? "Un instant…" : "Passer à cette offre"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {quote && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle>Confirmer votre paiement</CardTitle>
              <CardDescription>
                Offre {catalog?.plans.find((p) => p.key === quote.planKey)?.label}, {offerLabel(quote.months)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="font-display text-headline-md text-ink">
                {formatFcfa(quote.price)}
                {quote.kind !== "upgrade" && quote.founder && <span className="ml-2 text-body-sm text-ink-faint line-through">{formatFcfa(quote.normalPrice)}</span>}
              </p>
              {quote.kind === "upgrade" && (
                <div className="rounded-lg bg-surface-muted p-3 text-body-sm text-ink-soft">
                  <p>Prix de l&apos;offre : {formatFcfa(quote.fullPrice)}</p>
                  <p>Crédit de votre abonnement actuel ({quote.creditDays} jour{quote.creditDays > 1 ? "s" : ""} restants) : −{formatFcfa(quote.credit)}</p>
                  <p className="font-label-md text-ink">À payer : {formatFcfa(quote.price)}</p>
                </div>
              )}
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

        {catalog && noPlan && <PlanCards catalog={catalog} onChoose={choose} busyKey={busy} />}

        {payments.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Historique des paiements</CardTitle></CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border sm:hidden">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-label-md text-ink">{formatFcfa(p.amount)}</span>
                      <span className="text-body-sm text-ink-muted">{p.paidAt ? formatDateLabel(p.paidAt.slice(0, 10)) : "-"}</span>
                    </div>
                    <p className="text-body-sm text-ink-soft">{p.planLabel} · {offerLabel(p.months)}{p.kind === "upgrade" ? " (changement d'offre)" : ""}{p.status === "refunded" ? " (remboursé)" : ""} · {p.invoiceNumber ?? "-"}</p>
                    <Button variant="secondary" size="sm" className="self-start" onClick={() => accessToken && openAuthenticatedPdf(invoicePdfPath(p.id), accessToken)}>
                      <FileDown size={14} /> Reçu PDF
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reçu</TableHead>
                    <TableHead>Offre</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.invoiceNumber ?? "-"}</TableCell>
                      <TableCell>{p.planLabel} · {offerLabel(p.months)}{p.kind === "upgrade" ? " (changement d'offre)" : ""}{p.status === "refunded" ? " (remboursé)" : ""}</TableCell>
                      <TableCell>{p.paidAt ? formatDateLabel(p.paidAt.slice(0, 10)) : "-"}</TableCell>
                      <TableCell>{formatFcfa(p.amount)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => accessToken && openAuthenticatedPdf(invoicePdfPath(p.id), accessToken)}>
                          <FileDown size={14} /> Reçu PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
