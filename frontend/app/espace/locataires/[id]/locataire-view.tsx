"use client";



import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Send,
  FileCheck2,
  FileDown,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getRenter,
  entryReceiptPdfPath,
  moveOutReportPdfPath,
  type Renter,
  type Lease,
} from "@/lib/api/renters";
import { generateLeasePaymentLink } from "@/lib/api/paymentLinks";
import { PaymentLinkCard } from "@/components/payments/payment-link-card";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa, buildRentReminderMessage } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { DocumentDownloadStatus } from "@/components/documents/document-download-status";
import { Attribution } from "@/components/ui/attribution";
import { NoteSheet } from "@/components/notes/note-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useCan } from "@/lib/auth/use-can";
import { LeaseCard, NewLeaseCard } from "./sections/lease-cards";
import { EditRenterForm, PortalLinkCard } from "./sections/renter-cards";

export function LocataireView() {
  return (
    <RequireAuth>
      <LocataireContent />
    </RequireAuth>
  );
}

function LocataireContent() {
  const { id } = useParams<{ id: string }>();
  const renterId = Number(id);
  const { accessToken, tenant, user } = useAuth();
  // Le comptable peut retrouver un locataire et lui enregistrer un paiement
  // (section 5), mais ne gère pas la fiche/le bail/l'état des lieux : ça reste
  // le domaine de l'agent (ou du DG).
  const isDg = user?.role === "dg";
  const canManage = useCan("locataires");
  // Enregistrer un versement (loyer, pénalité, dette d'ouverture, lien de paiement) : permission dédiée.
  const canPay = useCan("loyers_encaisser");
  // Documents financiers (contrat de bail) : réservés à qui gère la relation
  // locataire ou à la comptabilité — la fiche elle-même est désormais
  // consultable par tout employé, mais pas la génération de documents.
  const canReadDocs = canManage || (user?.permissions.includes("comptabilite") ?? false);
  // PV de sortie : document généré par le module États des lieux, réservé à
  // sa propre permission (le serveur le refuse sinon).
  const canReadMoveOutPdf = useCan("etats_des_lieux");

  const [renter, setRenter] = React.useState<Renter | null>(null);
  const [leases, setLeases] = React.useState<Lease[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editingRenter, setEditingRenter] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(renterId)) return;
    getRenter(accessToken, renterId)
      .then((res) => {
        setRenter(res.renter);
        setLeases(res.leases);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Locataire introuvable."));
  }, [accessToken, renterId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!renter || !leases) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const activeLease = leases.find((l) => l.status === "active") ?? null;
  const pastLeases = leases.filter((l) => l.status !== "active");

  const whatsappMessage = activeLease?.arrears && activeLease.arrears.status === "late"
    ? buildRentReminderMessage({
        renterFirstName: renter.firstName,
        unitLabel: `${activeLease.unit.designationLabel} (${activeLease.unit.code})`,
        monthlyRent: activeLease.monthlyRent,
        daysLate: activeLease.arrears.daysLate,
        dueDate: activeLease.arrears.dueDate,
        companyName: tenant?.companyName,
      })
    : "";
  const whatsappHref = activeLease ? buildWhatsAppHref(renter.phone, whatsappMessage) : "#";

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/locataires" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux locataires
        </Link>

        {editingRenter ? (
          <EditRenterForm
            renter={renter}
            accessToken={accessToken}
            onSaved={(r) => {
              setRenter(r);
              setEditingRenter(false);
            }}
            onCancel={() => setEditingRenter(false)}
          />
        ) : (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-headline-xl text-ink">
                {renter.firstName} {renter.lastName}
              </h1>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditingRenter(true)}
                  aria-label="Modifier le locataire"
                  className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
            <p className="text-body-md text-ink-soft">
              {renter.phone}
              {renter.email ? ` · ${renter.email}` : ""}
              {renter.profession ? ` · ${renter.profession}` : ""}
            </p>
            <Attribution actor={renter.createdBy} verb="Fiche créée par" at={renter.createdAt} className="mt-1 block" />
          </div>
          {activeLease && (
            <div className="flex flex-wrap gap-2">
              {canManage && activeLease.arrears?.status === "late" && (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="inline-flex">
                  <Button variant="whatsapp" size="sm">
                    <Send size={16} />
                    Relancer sur WhatsApp
                  </Button>
                </a>
              )}
              {/* Document financier : accessible à l'agent/DG comme au comptable, pas à un agent sans aucune des deux permissions. */}
              {canReadDocs && (
                <Link href={`/espace/locataires/${renter.id}/contrat?leaseId=${activeLease.id}`}>
                  <Button variant="secondary" size="sm">
                    <FileCheck2 size={16} />
                    Contrat de bail
                  </Button>
                </Link>
              )}
              {canReadDocs && activeLease && (
                <DocumentDownloadStatus
                  documentType="contrat"
                  referenceId={activeLease.id}
                  accessToken={accessToken}
                  isDg={isDg}
                />
              )}
            </div>
          )}
        </div>
        )}

        <Card>
          <CardContent className="pt-5">
            <NoteSheet entityType="renter" entityId={renter.id} accessToken={accessToken} title="Fiche de notes du locataire" />
          </CardContent>
        </Card>

        {canManage && <PortalLinkCard renter={renter} accessToken={accessToken} onGenerated={load} />}

        {canPay && tenant?.onlinePaymentEnabled && activeLease && accessToken && (
          <PaymentLinkCard
            title="Lien de paiement en ligne"
            description={`Pour un règlement immédiat sans portail actif — ${renter.firstName} pourra payer par Mobile Money ou carte.`}
            phone={renter.phone}
            whatsappMessage={(url, amount) =>
              [
                `Bonjour ${renter.firstName},`,
                `Voici un lien pour régler votre loyer (${formatFcfa(amount)}) en ligne, par Mobile Money ou carte :`,
                url,
                `Ce lien expire sous 48h.`,
              ].join("\n")
            }
            onGenerate={() => generateLeasePaymentLink(accessToken, activeLease.id)}
          />
        )}

        {activeLease ? (
          <LeaseCard lease={activeLease} renterId={renter.id} renterFirstName={renter.firstName} renterPhone={renter.phone} accessToken={accessToken} canManage={canManage} canPay={canPay} canReadDocs={canReadDocs} isDg={isDg} onChanged={load} />
        ) : canManage ? (
          <NewLeaseCard renterId={renter.id} accessToken={accessToken} onCreated={load} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-body-sm text-ink-muted">
                Aucun bail actif pour ce locataire. Un agent ou la direction doit lui attribuer une
                nouvelle unité.
              </p>
            </CardContent>
          </Card>
        )}

        {pastLeases.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Historique des contrats</CardTitle>
              <CardDescription>Baux précédents de ce locataire.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border">
              {pastLeases.map((l) => {
                // Archive des locataires (étape du 2026-10-18, demande utilisateur : « conserver les
                // locataires qui ont quitté la maison avec tous les points financiers ») — ce bail
                // terminé garde tout son historique en base (voir `services/leaseEntryReceipt.js`,
                // `services/leaseDeposits.js`) ; cette carte l'affiche désormais plutôt que de s'en
                // tenir à une simple ligne de dates.
                const totalPaid = l.payments.reduce((sum, p) => sum + p.amount, 0);
                return (
                  <div key={l.id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-label-md text-ink">
                          {l.unit.designationLabel} ({l.unit.code})
                        </p>
                        <p className="text-body-xs text-ink-muted">
                          {l.startDate} → {l.endDate ?? "—"} · {formatFcfa(l.monthlyRent)}/mois
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {l.moveOutReport && canReadMoveOutPdf ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => accessToken && openAuthenticatedPdf(moveOutReportPdfPath(l.id), accessToken)}
                          >
                            <FileDown size={14} />
                            PV de sortie
                          </Button>
                        ) : (
                          <Badge variant="neutral">Terminé</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-ink-soft">
                      <span>Total loyers payés : <strong className="text-ink">{formatFcfa(totalPaid)}</strong></span>
                      {l.depositAmount > 0 && (
                        <span>
                          Caution : {formatFcfa(l.depositAmount)} ({l.depositStatus === "held" ? "conservée" : "restituée"})
                        </span>
                      )}
                      {l.entryReceiptNumber && accessToken && canReadDocs && (
                        <button
                          type="button"
                          onClick={() => openAuthenticatedPdf(entryReceiptPdfPath(l.id), accessToken)}
                          className="text-primary hover:underline"
                        >
                          Reçu d&apos;entrée {l.entryReceiptNumber}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Portail locataire (étape 12, idée n°2) : génère/régénère le lien secret
 * (sans mot de passe) donnant accès au tableau de bord du locataire — ses
 * paiements/quittances, son solde, son contrat de bail, et le signalement d'un
 * incident. Même logique de révélation unique que les identifiants d'un
 * employé (`app/espace/employes/nouveau`) : le token n'est affiché qu'une
 * fois ici, jamais ré-affichable ensuite (seul son empreinte est stockée).
 */
