"use client";



import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  FileDown,
  Building2,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import type { ChargeAccount } from "@/lib/api/charges";
import {
  getOwner,
  statementPdfPath,
  type Owner,
  type OwnerProperty,
  type OwnerPayout,
  type CommissionRate,
  type EscrowBalance,
  type DepositsHeld,
  type OwnerChargeRemittance,
  type DepositPosition,
  type DepositTransfer,
} from "@/lib/api/owners";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { DocumentDownloadStatus } from "@/components/documents/document-download-status";
import { NoteSheet } from "@/components/notes/note-sheet";
import { DepositTransferCard } from "./deposit-transfer-card";
import { Badge } from "@/components/ui/badge";
import { UtilityPointPanel } from "@/components/charges/utility-point-panel";
import { ChargeRemittanceCard } from "@/components/charges/charge-remittance-card";
import { Button } from "@/components/ui/button";
import { Attribution } from "@/components/ui/attribution";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { FedapayNotice, useFedapayEnabled } from "@/components/payments/fedapay-notice";
import { useCan } from "@/lib/auth/use-can";
import { CommissionCard } from "./sections/commission-card";
import { EscrowBalanceCard, RestrictedFinancialsNotice } from "./sections/escrow-card";
import { MandateCard } from "./sections/mandate-card";
import { EditOwnerForm, PortalLinkCard } from "./sections/owner-cards";
import { PayoutForm } from "./sections/payout-form";
import { UNIT_STATUS_BADGE } from "./sections/shared";

export function ProprietaireView() {
  return (
    <RequireAuth>
      <ProprietaireContent />
    </RequireAuth>
  );
}

function ProprietaireContent() {
  const { id } = useParams<{ id: string }>();
  const ownerId = Number(id);
  const { accessToken, user, tenant } = useAuth();
  // Enregistrer un versement est une action financière : ouverte au
  // comptable aussi (même logique que le registre des paiements locataires).
  const fedapayOn = useFedapayEnabled();
  const canPayout = useCan("reversements_proprietaires");
  // Modifier la fiche : même périmètre que la création (propriétaires, ou
  // locataires qui gère aussi les Biens/propriétaires à la volée).
  const canManage = user?.role === "dg" || (user?.permissions.includes("proprietaires") ?? false) || (user?.permissions.includes("locataires") ?? false);
  // Relevé PDF : réservé à qui gère la relation propriétaire/locataire ou à
  // la comptabilité — la fiche elle-même est désormais consultable par tout
  // employé, mais pas la génération de documents (même règle que côté serveur).
  const canReadDocs =
    user?.role === "dg" ||
    (user?.permissions.includes("proprietaires") ?? false) ||
    (user?.permissions.includes("comptabilite") ?? false) ||
    (user?.permissions.includes("locataires") ?? false);

  // Le carnet des charges relève du module Charges : même garde que côté serveur.
  const canSeeCharges = tenant?.chargesEnabled !== false && (user?.role === "dg" || (user?.permissions.includes("charges") ?? false));

  const [owner, setOwner] = React.useState<Owner | null>(null);
  // Faux pour un employé sans permission `proprietaires`/`comptabilite`/`locataires` (ex. seulement
  // `plaintes`) — audit du 2026-10-23 : la fiche exposait jusqu'ici tout le détail financier à
  // n'importe quel employé connecté. Pilote l'affichage des sections financières ci-dessous.
  const [canSeeFinancials, setCanSeeFinancials] = React.useState(true);
  const [properties, setProperties] = React.useState<OwnerProperty[] | null>(null);
  const [payouts, setPayouts] = React.useState<OwnerPayout[] | null>(null);
  const [escrowBalance, setEscrowBalance] = React.useState<EscrowBalance | null>(null);
  const [depositsHeld, setDepositsHeld] = React.useState<DepositsHeld | null>(null);
  const [depositPositions, setDepositPositions] = React.useState<{ items: DepositPosition[]; withOwnerTotal: number }>({ items: [], withOwnerTotal: 0 });
  const [depositTransfers, setDepositTransfers] = React.useState<DepositTransfer[]>([]);
  const [openingDebtUnpaid, setOpeningDebtUnpaid] = React.useState(0);
  const [chargesAccount, setChargesAccount] = React.useState<ChargeAccount | null>(null);
  const [chargeRemittances, setChargeRemittances] = React.useState<OwnerChargeRemittance[]>([]);
  const [activeCommissionRate, setActiveCommissionRate] = React.useState<CommissionRate | null>(null);
  const [commissionRates, setCommissionRates] = React.useState<CommissionRate[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editingOwner, setEditingOwner] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(ownerId)) return;
    getOwner(accessToken, ownerId)
      .then((res) => {
        setOwner(res.owner);
        setCanSeeFinancials(res.canSeeFinancials);
        setProperties(res.properties);
        setPayouts(res.payouts);
        setEscrowBalance(res.escrowBalance);
        setDepositsHeld(res.depositsHeld);
        setDepositPositions(res.depositPositions ?? { items: [], withOwnerTotal: 0 });
        setDepositTransfers(res.depositTransfers ?? []);
        setOpeningDebtUnpaid(res.openingDebtUnpaid);
        setChargesAccount(res.chargesAccount);
        setChargeRemittances(res.chargeRemittances);
        setActiveCommissionRate(res.activeCommissionRate);
        setCommissionRates(res.commissionRates);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Propriétaire introuvable."));
  }, [accessToken, ownerId]);

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

  if (!owner || !properties || !payouts) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const occupiedRentTotal = properties
    .flatMap((p) => p.units)
    .filter((u) => u.status === "loue")
    .reduce((sum, u) => sum + u.monthlyRent, 0);
  const unitsCount = properties.flatMap((p) => p.units).length;
  const unitsOccupied = properties.flatMap((p) => p.units).filter((u) => u.status === "loue").length;
  // Archive des propriétaires (étape du 2026-10-18, demande utilisateur) : mandat terminé
  // volontairement par le DG — fiche en LECTURE SEULE (décision explicite), seule
  // « Réactiver le mandat » (DG) permet d'en ressortir. Jamais mélangé au patrimoine/aux chiffres
  // ci-dessus, qui restent affichés tels quels (l'historique financier doit rester visible).
  const archived = !!owner.mandateEndedAt;
  const isDg = user?.role === "dg";

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/proprietaires" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux propriétaires
        </Link>

        {editingOwner ? (
          <EditOwnerForm
            owner={owner}
            accessToken={accessToken}
            onSaved={(o) => {
              setOwner(o);
              setEditingOwner(false);
            }}
            onCancel={() => setEditingOwner(false)}
          />
        ) : (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-headline-xl text-ink">{owner.name}</h1>
              {canManage && !archived && (
                <button
                  type="button"
                  onClick={() => setEditingOwner(true)}
                  aria-label="Modifier le propriétaire"
                  className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-body-sm text-ink-soft">
              {owner.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} className="text-ink-muted" /> {owner.phone}
                </span>
              )}
              {owner.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail size={14} className="text-ink-muted" /> {owner.email}
                </span>
              )}
              {owner.address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} className="text-ink-muted" /> {owner.address}
                </span>
              )}
            </div>
            <Attribution actor={owner.createdBy} verb="Fiche créée par" at={owner.createdAt} className="mt-1 block" />
          </div>
          {canReadDocs && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => accessToken && openAuthenticatedPdf(statementPdfPath(owner.id), accessToken)}
              >
                <FileDown size={16} />
                Générer le relevé
              </Button>
              <DocumentDownloadStatus
                documentType="releve_proprietaire"
                referenceId={owner.id}
                accessToken={accessToken}
                isDg={user?.role === "dg"}
              />
            </div>
          )}
        </div>
        )}

        {isDg && (
          <MandateCard owner={owner} properties={properties} accessToken={accessToken} onChanged={load} />
        )}

        {canManage && !archived && <PortalLinkCard owner={owner} accessToken={accessToken} onGenerated={load} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col gap-1 py-5">
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Biens gérés</span>
              <span className="font-display text-headline-md text-ink">{properties.length}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1 py-5">
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Unités occupées</span>
              <span className="font-display text-headline-md text-ink">{unitsOccupied}/{unitsCount}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1 py-5">
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Loyers mensuels en cours</span>
              <span className="tabular font-currency-table text-headline-md text-ink">{formatFcfa(occupiedRentTotal)}</span>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Patrimoine géré</CardTitle>
            <CardDescription>Biens et unités rattachés à ce propriétaire.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {properties.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun bien rattaché à ce propriétaire pour le moment.</p>
            ) : (
              properties.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-primary" />
                      <span className="font-label-md text-ink">{p.code}</span>
                      <Badge variant="neutral">{p.typeLabel}</Badge>
                    </div>
                    <Link href={`/espace/biens/${p.id}`} className="text-body-xs text-primary hover:underline">
                      Voir le bien
                    </Link>
                  </div>
                  {p.address && <p className="mb-3 text-body-xs text-ink-muted">{p.address}</p>}
                  {p.units.length === 0 ? (
                    <p className="text-body-sm text-ink-muted">Aucune unité pour ce bien.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {p.units.map((u) => {
                        const badge = UNIT_STATUS_BADGE[u.status];
                        return (
                          <div key={u.id} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2">
                            <div>
                              <p className="font-label-sm text-ink">{u.code} — {u.designationLabel}</p>
                              <p className="text-body-xs text-ink-muted">
                                {formatFcfa(u.monthlyRent)}/mois{u.currentRenter ? ` · ${u.currentRenter}` : ""}
                              </p>
                            </div>
                            <Badge variant={badge.variant} dot>{badge.label}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {canPayout && (
          <CommissionCard
            ownerId={owner.id}
            ownerName={owner.name}
            isDg={isDg && !archived}
            activeRate={activeCommissionRate}
            rates={commissionRates}
            accessToken={accessToken}
            onUpdated={load}
          />
        )}

        {canSeeFinancials ? (
          <EscrowBalanceCard escrow={escrowBalance} depositsHeld={depositsHeld} openingDebtUnpaid={openingDebtUnpaid} />
        ) : (
          <RestrictedFinancialsNotice />
        )}

        <Card>
          <CardContent className="pt-5">
            <NoteSheet entityType="owner" entityId={owner.id} accessToken={accessToken} title="Fiche de notes du propriétaire" placeholder="Relation, préférences, modalités de versement, points d'attention…" />
          </CardContent>
        </Card>

        {canSeeFinancials && (
          <DepositTransferCard
            ownerId={owner.id}
            ownerName={owner.name}
            positions={depositPositions.items}
            withOwnerTotal={depositPositions.withOwnerTotal}
            transfers={depositTransfers}
            accessToken={accessToken}
            canRecord={canPayout && !archived}
            onChanged={load}
          />
        )}

        {chargesAccount && (
          <ChargeRemittanceCard
            ownerId={owner.id}
            ownerName={owner.name}
            account={chargesAccount}
            remittances={chargeRemittances}
            accessToken={accessToken}
            canRecord={canPayout && !archived}
            onChanged={load}
          />
        )}

        {canSeeCharges && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Carnet des charges SONEB / SBEE</CardTitle>
                  <CardDescription>
                    Ce que ce propriétaire a payé à la SONEB/SBEE face à ce qui a été encaissé chez ses locataires, mois par mois.
                  </CardDescription>
                </div>
                <DocumentDownloadStatus
                  documentType="carnet_charges"
                  referenceId={owner.id}
                  accessToken={accessToken}
                  isDg={user?.role === "dg"}
                />
              </div>
            </CardHeader>
            <CardContent>
              <UtilityPointPanel ownerId={owner.id} />
            </CardContent>
          </Card>
        )}

        {canSeeFinancials && (
        <Card>
          <CardHeader>
            <CardTitle>Versements</CardTitle>
            <CardDescription>Historique des loyers nets reversés à ce propriétaire.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canPayout && !archived && (fedapayOn ? (
              <FedapayNotice what="le versement des loyers à ce propriétaire" />
            ) : (
              <PayoutForm ownerId={owner.id} ownerName={owner.name} accessToken={accessToken} onRecorded={load} />
            ))}

            {payouts.length === 0 ? (
              <p className="text-body-sm text-ink-muted">Aucun versement enregistré pour ce propriétaire.</p>
            ) : (
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Période</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Enregistré par</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.periodLabel}</TableCell>
                      <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                      <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                      <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                      <TableCell className="text-ink-soft">
                        {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}

/** Remplace les cartes financières quand l'employé n'a aucune permission financière sur ce propriétaire
 * (ni `proprietaires`, ni `comptabilite`, ni `locataires`) — la fiche reste consultable (identité,
 * patrimoine) mais le détail des sommes (séquestre, cautions, versements, commission) reste masqué. */
