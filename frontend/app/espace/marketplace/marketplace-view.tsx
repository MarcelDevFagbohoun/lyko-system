"use client";

import * as React from "react";
import { Store, Trash2, ImageOff, Home, Clock, CheckCircle2, XCircle, PhoneCall } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { API_URL } from "@/lib/api/client";
import {
  listMyListings,
  unpublishListing,
  listMarketplaceRequests,
  updateMarketplaceRequestStatus,
  type MarketplaceListing,
  type MarketplaceRequest,
  type RequestStatus,
} from "@/lib/api/marketplace";
import { PROPERTY_TYPE_LABELS, unitDesignationLabel } from "@/lib/constants/properties";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

/**
 * Marketplace — page interne de gestion des annonces publiées (back-office).
 * L'affichage public vit désormais sur un site externe séparé (relié via
 * `GET /api/marketplace/public/:tenantId`), plus du tout sur cette
 * plateforme — cette page ne fait plus que lister/retirer les annonces déjà
 * publiées. Publier une nouvelle annonce se fait depuis la fiche du Bien.
 */
export function MarketplaceView() {
  return (
    <RequireAuth permission={["locataires", "proprietaires"]}>
      <MarketplaceContent />
    </RequireAuth>
  );
}

function MarketplaceContent() {
  const { accessToken } = useAuth();
  const [listings, setListings] = React.useState<MarketplaceListing[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listMyListings(accessToken)
      .then((res) => setListings(res.listings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger la marketplace."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Marketplace</h1>
          <p className="text-body-md text-ink-soft">
            Les annonces publiées ici sont affichées sur le site externe relié à votre cabinet.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <RequestsSection accessToken={accessToken} />

        <Card>
          <CardHeader>
            <CardTitle>Annonces publiées</CardTitle>
            <CardDescription>
              Pour publier une nouvelle annonce, ouvrez la fiche du Bien concerné et utilisez le bouton « Publier »
              sur l&apos;Unité vacante.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {listings === null && !error ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : listings && listings.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
                <Store size={16} /> Aucune annonce publiée pour l&apos;instant.
              </p>
            ) : listings ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((l) => (
                  <ListingCard key={l.id} listing={l} accessToken={accessToken} onChanged={load} />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const REQUEST_STATUS_BADGE: Record<
  RequestStatus,
  { variant: "neutral" | "warning" | "success" | "danger"; label: string; icon: typeof Clock }
> = {
  en_attente: { variant: "neutral", label: "En attente", icon: Clock },
  contactee: { variant: "warning", label: "Contactée", icon: PhoneCall },
  acceptee: { variant: "success", label: "Acceptée", icon: CheckCircle2 },
  refusee: { variant: "danger", label: "Refusée", icon: XCircle },
};

/**
 * Demandes « confier un bien » (louer/vendre) envoyées depuis Quick Immo par
 * un propriétaire — une simple demande à valider par un humain : aucune
 * création automatique d'un Bien, voir backend `routes/marketplaceAccounts.js`.
 */
function RequestsSection({ accessToken }: { accessToken: string | null }) {
  const [requests, setRequests] = React.useState<MarketplaceRequest[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listMarketplaceRequests(accessToken)
      .then((res) => setRequests(res.requests))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les demandes."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleUpdate(id: number, status: Exclude<RequestStatus, "en_attente">) {
    if (!accessToken) return;
    try {
      await updateMarketplaceRequestStatus(accessToken, id, status);
      toast.success("Demande mise à jour.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de mettre à jour cette demande.");
    }
  }

  const pendingCount = requests?.filter((r) => r.status === "en_attente").length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demandes reçues (Quick Immo)</CardTitle>
        <CardDescription>
          Des propriétaires souhaitant louer ou vendre leur bien, envoyées depuis le site externe. Aucun Bien n&apos;est
          créé automatiquement — contactez le propriétaire puis saisissez-le normalement si vous l&apos;acceptez.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {requests === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : requests && requests.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
            <Home size={16} /> Aucune demande reçue pour l&apos;instant.
          </p>
        ) : requests ? (
          <div className="flex flex-col divide-y divide-border">
            {requests.map((r) => {
              const s = REQUEST_STATUS_BADGE[r.status];
              const Icon = s.icon;
              return (
                <div key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-label-md text-ink">
                      {r.requestType === "louer" ? "Mettre en location" : "Vendre"} — {r.address}
                    </p>
                    <p className="text-body-sm text-ink-soft">
                      {r.owner.name} · {r.owner.phone}
                    </p>
                    {r.description && <p className="text-body-sm text-ink-muted">{r.description}</p>}
                    <p className="text-body-xs text-ink-faint">
                      Envoyée le {r.createdAt.slice(0, 10)}
                      {r.reviewedBy && ` · Traitée par ${r.reviewedBy.name} (${r.reviewedBy.roleLabel})`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={s.variant}>
                      <Icon size={12} />
                      {s.label}
                    </Badge>
                    {r.status === "en_attente" && (
                      <Button variant="secondary" size="sm" onClick={() => handleUpdate(r.id, "contactee")}>
                        Contactée
                      </Button>
                    )}
                    {(r.status === "en_attente" || r.status === "contactee") && (
                      <>
                        <Button variant="success" size="sm" onClick={() => handleUpdate(r.id, "acceptee")}>
                          Accepter
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleUpdate(r.id, "refusee")}>
                          Refuser
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {requests && pendingCount === 0 && requests.length > 0 && (
          <p className="mt-3 text-body-xs text-ink-faint">Aucune demande en attente.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ListingCard({
  listing,
  accessToken,
  onChanged,
}: {
  listing: MarketplaceListing;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  async function handleUnpublish() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      await unpublishListing(accessToken, listing.unitId);
      toast.success(`Annonce ${listing.unitCode} retirée de la marketplace.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de retirer cette annonce.");
      setSubmitting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-36 items-center justify-center bg-surface-muted">
        {listing.photoUrls[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${listing.photoUrls[0]}`} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageOff size={24} className="text-ink-faint" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="font-label-md text-ink">
          {listing.propertyCode} · {listing.unitCode}
        </p>
        <p className="text-body-xs text-ink-muted">
          {unitDesignationLabel(listing.designation, listing.designationCustom)} · {PROPERTY_TYPE_LABELS[listing.propertyType]}
        </p>
        <p className="tabular font-currency-table text-ink">{formatFcfa(listing.monthlyRent)}/mois</p>
        <p className="text-body-xs text-ink-faint">Publiée le {listing.publishedAt}</p>
        <div className="mt-auto pt-2">
          {confirming ? (
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-body-xs text-danger-fg">Confirmer ?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
                Non
              </Button>
              <Button variant="destructive" size="sm" onClick={handleUnpublish} disabled={submitting}>
                {submitting ? "…" : "Oui"}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} className="w-full justify-center">
              <Trash2 size={14} />
              Retirer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
