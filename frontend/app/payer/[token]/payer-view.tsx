"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Building2, CalendarClock, FileText, Lock, Phone, User } from "lucide-react";
import { API_URL, ApiError } from "@/lib/api/client";
import { getPaymentLink, startPaymentLinkCheckout, type PaymentLinkInfo } from "@/lib/api/paymentLinks";
import { PayNowButton } from "@/components/payments/pay-now-button";
import { formatFcfa } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Page publique de paiement par lien (personnel → locataire sans portail
 * actif, envoyé à la main par WhatsApp) — sans compte, sans mot de passe :
 * le token du chemin est le seul secret, comme le portail locataire.
 */
export function PayerView() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = React.useState<PaymentLinkInfo | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    getPaymentLink(token)
      .then(setLink)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Ce lien de paiement est invalide ou expiré."),
      );
  }, [token]);

  const steps = [
    "Vérifiez le montant et le motif du paiement ci-dessus.",
    "Appuyez sur « Payer maintenant ». Vous arrivez sur la page sécurisée de paiement.",
    "Choisissez votre moyen de paiement (MTN, Moov, Celtiis ou carte bancaire) et saisissez votre numéro.",
    "Confirmez sur votre téléphone avec votre code secret si on vous le demande.",
    "Revenez sur cette page : vous voyez la confirmation et l'entreprise est prévenue aussitôt.",
  ];
  const expires = link ? new Date(link.expiresAt).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
  type Row = { icon: React.ReactNode; label: string; value: string };
  const rows: Row[] = link
    ? ([
        link.payerName ? { icon: <User size={16} />, label: "Payeur", value: link.payerName } : null,
        { icon: <FileText size={16} />, label: "Motif", value: link.reason },
        link.unitLabel || link.propertyAddress
          ? { icon: <Building2 size={16} />, label: "Logement", value: [link.unitLabel, link.propertyAddress].filter(Boolean).join(", ") }
          : null,
        { icon: <CalendarClock size={16} />, label: "Lien valable jusqu'au", value: expires },
      ] as (Row | null)[]).filter((r): r is Row => r !== null)
    : [];

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas">
      <header className="flex w-full flex-col items-center gap-2 border-b border-border bg-surface px-4 py-5">
        {link?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${link.logoUrl}`} alt={link.companyName ?? "Logo"} className="h-14 w-auto max-w-[70vw] object-contain sm:h-16" />
        ) : null}
        <span className="font-display text-headline-md text-ink">{link?.companyName ?? "Africa Immo Management"}</span>
      </header>

      <main className="flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6 sm:py-10">
        {loadError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle size={28} className="text-danger-fg" />
              <p className="font-label-md text-ink">{loadError}</p>
              <p className="text-body-sm text-ink-muted">Demandez un nouveau lien à votre agence si celui-ci ne fonctionne plus.</p>
            </CardContent>
          </Card>
        ) : !link ? (
          <p className="py-10 text-center text-body-sm text-ink-muted">Chargement…</p>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-col gap-5 pb-6 pt-6">
                <div className="text-center">
                  <p className="text-body-sm text-ink-muted">Demande de paiement</p>
                  <p className="tabular font-display text-headline-xl text-ink sm:text-[2.25rem]">{formatFcfa(link.amount)}</p>
                </div>
                <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {rows.map((r) => (
                    <div key={r.label} className="flex items-start gap-3 px-3 py-2.5">
                      <span className="mt-0.5 shrink-0 text-ink-muted">{r.icon}</span>
                      <div className="min-w-0">
                        <dt className="text-body-xs text-ink-muted">{r.label}</dt>
                        <dd className="break-words font-label-md text-ink">{r.value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
                {link.onlinePaymentEnabled ? (
                  <div className="flex flex-col [&_button]:h-12 [&_button]:w-full [&_button]:text-body-md">
                    <PayNowButton start={() => startPaymentLinkCheckout(token)} />
                  </div>
                ) : (
                  <p className="text-center text-body-sm text-danger-fg">Le paiement en ligne n&apos;est plus disponible pour le moment.</p>
                )}
                <p className="flex items-center justify-center gap-1.5 text-center text-body-xs text-ink-muted">
                  <Lock size={12} className="shrink-0" /> Paiement sécurisé par FedaPay. Vos codes ne sont jamais partagés avec nous.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-3 pb-5 pt-5">
                <h2 className="font-display text-headline-sm text-ink">Comment payer</h2>
                <ol className="flex flex-col gap-3">
                  {steps.map((t, i) => (
                    <li key={i} className="flex items-start gap-3 text-body-sm text-ink-soft">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-bg font-label-sm text-primary">{i + 1}</span>
                      <span className="pt-0.5">{t}</span>
                    </li>
                  ))}
                </ol>
                <p className="rounded-lg bg-surface-muted p-3 text-body-xs text-ink-muted">
                  Ne communiquez jamais votre code secret à une autre personne. En cas de problème ou si le paiement est débité sans confirmation,
                  contactez {link.companyName ?? "votre agence"}{link.companyPhone ? " au " : "."}
                  {link.companyPhone && (
                    <a href={`tel:${link.companyPhone}`} className="inline-flex items-center gap-1 font-label-md text-primary underline">
                      <Phone size={12} />{link.companyPhone}
                    </a>
                  )}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
