"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { FileCheck2, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { API_URL, ApiError } from "@/lib/api/client";
import {
  getPortalDashboard,
  submitPortalComplaint,
  portalReceiptPdfUrl,
  portalCertificatePdfUrl,
  type PortalDashboard,
  type PortalComplaintInput,
} from "@/lib/api/portal";
import type { ComplaintCategory } from "@/lib/api/complaints";
import { COMPLAINT_CATEGORY_LABELS } from "@/lib/constants/complaints";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
};

/**
 * Portail locataire (étape 12, idée n°2) : page publique, sans compte ni mot
 * de passe — le token du chemin est le seul secret. Ni `RequireAuth` ni
 * `EspaceHeader` ici, volontairement : cette page ne doit jamais dépendre
 * d'une session employé.
 */
export function PortailView() {
  const { token } = useParams<{ token: string }>();
  const [dashboard, setDashboard] = React.useState<PortalDashboard | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!token) return;
    getPortalDashboard(token)
      .then(setDashboard)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Ce lien est momentanément inaccessible."),
      );
  }, [token]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <PortailShell>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle size={28} className="text-danger-fg" />
            <p className="font-label-md text-ink">{loadError}</p>
            <p className="text-body-sm text-ink-muted">
              Demandez un nouveau lien à votre agence si celui-ci ne fonctionne plus.
            </p>
          </CardContent>
        </Card>
      </PortailShell>
    );
  }

  if (!dashboard) {
    return (
      <PortailShell>
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      </PortailShell>
    );
  }

  const { tenant, renter, activeLease, arrears, payments } = dashboard;

  return (
    <PortailShell tenant={tenant}>
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div>
          <h1 className="font-display text-headline-lg text-ink">
            Bonjour {renter.firstName} {renter.lastName}
          </h1>
          <p className="text-body-sm text-ink-muted">Votre espace personnel, mis à jour en temps réel.</p>
        </div>

        {!activeLease ? (
          <Card>
            <CardContent className="py-6 text-center text-body-sm text-ink-muted">
              Aucun bail actif n&apos;est associé à ce lien pour le moment.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>
                    {activeLease.designationLabel} <span className="text-ink-muted">({activeLease.unitCode})</span>
                  </CardTitle>
                  {arrears?.status === "late" ? (
                    <Badge variant="danger" dot>
                      En retard {arrears.daysLate} j
                    </Badge>
                  ) : (
                    <Badge variant="success" dot>
                      À jour
                    </Badge>
                  )}
                </div>
                <CardDescription>Locataire depuis le {activeLease.startDate}.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Metric label="Loyer mensuel" value={formatFcfa(activeLease.monthlyRent)} />
                  <Metric
                    label="Payé jusqu'à"
                    value={arrears?.paidThroughMonth ? monthLabelFr(arrears.paidThroughMonth) : "Aucun mois"}
                  />
                  <Metric label="Prochaine échéance" value={arrears?.dueDate ?? "—"} />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
                  onClick={() => window.open(portalCertificatePdfUrl(token), "_blank", "noopener,noreferrer")}
                >
                  <FileCheck2 size={16} />
                  Télécharger mon attestation de loyer
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mes paiements & quittances</CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <p className="text-body-sm text-ink-muted">Aucun paiement enregistré pour l&apos;instant.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead>Période</TableHead>
                        <TableHead className="text-right">Montant</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Quittance</TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{monthLabelFr(p.coversMonth)}</TableCell>
                          <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                          <TableCell className="text-ink-soft">
                            {PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}
                          </TableCell>
                          <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                          <TableCell className="text-right">
                            {p.receipt && (
                              <a
                                href={portalReceiptPdfUrl(token, p.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-label-sm text-primary hover:underline"
                              >
                                <FileText size={14} />
                                {p.receipt.number}
                              </a>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <ComplaintForm token={token} />
          </>
        )}
      </div>
    </PortailShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="tabular font-currency-table text-ink">{value}</span>
    </div>
  );
}

const CATEGORIES = Object.entries(COMPLAINT_CATEGORY_LABELS) as [ComplaintCategory, string][];

/** Signalement d'incident directement par le locataire (idée n°2, action « essentielle »). */
function ComplaintForm({ token }: { token: string }) {
  const [category, setCategory] = React.useState<ComplaintCategory>("plomberie");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [urgent, setUrgent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Décrivez brièvement le problème.");
    setSubmitting(true);
    setError(null);
    try {
      const input: PortalComplaintInput = {
        category,
        title: title.trim(),
        priority: urgent ? "urgente" : "normale",
      };
      if (description.trim()) input.description = description.trim();
      const res = await submitPortalComplaint(token, input);
      setSent(res.code);
      setTitle("");
      setDescription("");
      setUrgent(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer ce signalement pour le moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signaler un problème</CardTitle>
        <CardDescription>Une fuite, une panne, un souci de serrure… décrivez-le, votre agence sera notifiée.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="flex items-center gap-2 rounded-lg border border-success-border bg-success-bg px-3 py-2.5 text-body-sm text-success-fg">
            <CheckCircle2 size={16} className="shrink-0" />
            Signalement envoyé ({sent}). Votre agence va le traiter.
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setSent(null)}>
              Signaler autre chose
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Catégorie" htmlFor="portalCategory" required>
                <select
                  id="portalCategory"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {CATEGORIES.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Titre" htmlFor="portalTitle" required>
                <Input id="portalTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Fuite robinet cuisine" />
              </Field>
            </div>
            <Field label="Détails (optionnel)" htmlFor="portalDescription">
              <Input id="portalDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-body-sm text-ink-soft">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 rounded border-border-strong" />
              C&apos;est urgent
            </label>
            <Button type="submit" variant="warning" disabled={submitting} className="self-start">
              {submitting ? "Envoi…" : "Envoyer le signalement"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PortailShell({
  tenant,
  children,
}: {
  tenant?: PortalDashboard["tenant"];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas">
      <header className="flex w-full items-center justify-center border-b border-border bg-surface px-4 py-4">
        {tenant?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${tenant.logoUrl}`} alt={tenant.companyName ?? "Logo"} className="h-9 w-auto object-contain" />
        ) : (
          <span className="font-display text-headline-md text-ink">{tenant?.companyName ?? "Lyko System"}</span>
        )}
      </header>
      <main className="flex w-full flex-1 flex-col items-center px-4 py-10">{children}</main>
    </div>
  );
}
