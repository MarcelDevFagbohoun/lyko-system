"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  fetchCatalog, fetchSubscription, fetchQuote, fetchUpgradeOptions, startCheckout, listSubscriptionPayments, invoicePdfPath,
  listMyRefunds, offerLabel, PENDING_OFFER_KEY,
  type Catalog, type PlanKey, type Quote, type Refund, type Subscription, type SubscriptionPayment, type UpgradeOption,
} from "@/lib/api/billing";
import { RequireAuth } from "@/components/auth/require-auth";
import { PlanPicker } from "@/components/billing/plan-picker";
import { SubscriptionSummary } from "@/components/billing/subscription-summary";
import { CheckoutSummary } from "@/components/billing/checkout-summary";
import { PaymentHistory } from "@/components/billing/payment-history";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  // Le récapitulatif s'ouvre en haut de page : on y amène l'écran (surtout sur téléphone, où les offres sont longues).
  const quoteRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (quote) quoteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [quote]);

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
  const isInterne = sub?.planKey === "interne";
  const currentPlan = sub?.active && !isInterne ? catalog?.plans.find((p) => p.key === sub.planKey) ?? null : null;
  const reviewing = refunds.some((r) => ["requested", "approved", "details_received", "processing", "failed"].includes(r.status));
  const lastRejected = refunds.find((r) => r.status === "rejected");
  const pendingFirst = sub?.status === "pending_payment";

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-8 py-8 sm:py-10">
        <header>
          <h1 className="font-display text-headline-lg text-ink">{pendingFirst ? "Bienvenue ! Choisissez votre offre" : "Abonnement"}</h1>
          <p className="text-body-md text-ink-soft">
            {pendingFirst
              ? "Votre e-mail est confirmé. Choisissez une offre et réglez-la pour ouvrir votre espace. Vous recevrez ensuite votre reçu par e-mail."
              : noPlan
                ? "Votre abonnement n'est pas actif. Choisissez une offre pour retrouver l'accès à votre espace."
                : "Votre offre en cours, les offres disponibles, vos paiements et vos reçus."}
          </p>
        </header>

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

        {sub?.overLimits && sub.overLimits.length > 0 && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-bg p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-fg" />
            <div>
              <p className="font-label-md text-warning-fg">Vous dépassez les limites de votre offre</p>
              <p className="text-body-sm text-ink-soft">
                {sub.overLimits.map((l) => `${l.count} ${l.label} pour ${l.max} autorisés`).join(" · ")}. Passez à une offre supérieure pour en ajouter d&apos;autres.
              </p>
            </div>
          </div>
        )}

        {isInterne && (
          <Card>
            <CardHeader>
              <CardTitle>Compte interne</CardTitle>
              <CardDescription>Votre entreprise dispose de toutes les fonctions, sans limite ni échéance.</CardDescription>
            </CardHeader>
          </Card>
        )}

        {currentPlan && sub && <SubscriptionSummary plan={currentPlan} sub={sub} />}

        {quote && catalog && (
          <div ref={quoteRef} className="scroll-mt-6">
            <CheckoutSummary quote={quote} catalog={catalog} paying={busy === "pay"} onPay={pay} onCancel={() => setQuote(null)} />
          </div>
        )}

        {catalog && !isInterne && (
          <section aria-labelledby="offres-title" className="flex flex-col gap-4">
            <div>
              <h2 id="offres-title" className="font-display text-headline-md text-ink">
                {currentPlan ? "Renouveler ou changer d'offre" : "Choisissez votre offre"}
              </h2>
              <p className="text-body-sm text-ink-muted">
                {currentPlan
                  ? "Passer à une offre supérieure déduit les jours qu'il vous reste. Aucun prélèvement automatique : vous renouvelez quand vous le décidez."
                  : "Aucun prélèvement automatique : vous renouvelez quand vous le décidez."}
              </p>
            </div>
            <PlanPicker catalog={catalog} sub={sub} upgrades={upgrades} firstPurchase={!payments.some((p) => p.outcome === "success")} busyKey={busy} onChoose={choose} />
          </section>
        )}

        <PaymentHistory payments={payments} onOpenReceipt={(id) => accessToken && openAuthenticatedPdf(invoicePdfPath(id), accessToken)} />

        {currentPlan && (
          <section aria-labelledby="annulation-title" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <h2 id="annulation-title" className="font-label-md text-ink">Garantie et annulation</h2>
            {sub?.refundOpen && sub.refundEligibleUntil && (
              <p className="text-body-sm text-ink-muted">
                Votre premier abonnement est remboursable jusqu&apos;au {formatDateLabel(sub.refundEligibleUntil.slice(0, 10))}, frais du prestataire de paiement déduits.
              </p>
            )}
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
          </section>
        )}
      </div>
    </div>
  );
}
