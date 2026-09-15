"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart, ImageOff, Home as HomeIcon, Clock, CheckCircle2, XCircle, PhoneCall } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL, ApiError } from "@/lib/api/client";
import { listFavorites, listMyRequests, removeFavorite, type FavoriteListing, type OwnerRequest } from "@/lib/api/accounts";
import { PROPERTY_TYPE_LABELS, unitDesignationLabel } from "@/lib/constants/properties";
import { formatFcfa } from "@/lib/utils";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/lib/toast/toast-context";

const STATUS_BADGE: Record<OwnerRequest["status"], { variant: "neutral" | "success" | "warning" | "danger"; label: string; icon: typeof Clock }> = {
  en_attente: { variant: "neutral", label: "En attente", icon: Clock },
  contactee: { variant: "warning", label: "Contactée", icon: PhoneCall },
  acceptee: { variant: "success", label: "Acceptée", icon: CheckCircle2 },
  refusee: { variant: "danger", label: "Refusée", icon: XCircle },
};

export default function MonComptePage() {
  const { account, accessToken, status, logout } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/connexion");
  }, [status, router]);

  if (status === "loading" || !account) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <Header />
        <main className="flex flex-1 items-center justify-center py-12">
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="flex-1">
        <div className="content-shell flex flex-col gap-6 py-10">
          <div>
            <h1 className="font-display text-headline-xl text-ink">
              Bonjour {account.firstName} {account.lastName}
            </h1>
            <p className="text-body-md text-ink-soft">
              {account.role === "chercheur" ? "Vos biens favoris." : "Le suivi de vos demandes."}
            </p>
          </div>

          {account.role === "chercheur" ? (
            <FavoritesSection accessToken={accessToken} />
          ) : (
            <RequestsSection accessToken={accessToken} />
          )}

          <div>
            <Button variant="ghost" onClick={() => { logout(); router.push("/"); }}>
              Se déconnecter
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function FavoritesSection({ accessToken }: { accessToken: string | null }) {
  const [favorites, setFavorites] = React.useState<FavoriteListing[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listFavorites(accessToken)
      .then((res) => setFavorites(res.favorites))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger vos favoris."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleRemove(unitId: number) {
    if (!accessToken) return;
    try {
      await removeFavorite(accessToken, unitId);
      toast.success("Retiré de vos favoris.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de retirer ce favori.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mes favoris</CardTitle>
        <CardDescription>Les biens que vous avez sauvegardés.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {favorites === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : favorites && favorites.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
            <Heart size={16} /> Aucun favori pour l&apos;instant.{" "}
            <Link href="/" className="text-primary hover:underline">
              Parcourir les annonces
            </Link>
          </p>
        ) : favorites ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((f) => (
              <div key={f.unitId} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
                <div className="flex h-32 items-center justify-center bg-surface-muted">
                  {f.photoUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${API_URL}${f.photoUrls[0]}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff size={22} className="text-ink-faint" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="font-label-md text-ink">
                    {PROPERTY_TYPE_LABELS[f.propertyType as keyof typeof PROPERTY_TYPE_LABELS]} —{" "}
                    {unitDesignationLabel(f.designation as never, f.designationCustom)}
                  </p>
                  <p className="tabular font-currency-table text-ink">{formatFcfa(f.monthlyRent)}/mois</p>
                  {!f.stillAvailable && <Badge variant="neutral">Plus disponible</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => handleRemove(f.unitId)} className="mt-auto w-full justify-center">
                    Retirer des favoris
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RequestsSection({ accessToken }: { accessToken: string | null }) {
  const [requests, setRequests] = React.useState<OwnerRequest[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listMyRequests(accessToken)
      .then((res) => setRequests(res.requests))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger vos demandes."));
  }, [accessToken]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Mes demandes</CardTitle>
            <CardDescription>Le suivi des biens confiés à nos agences partenaires.</CardDescription>
          </div>
          <Link href="/confier-un-bien" className={buttonVariants({ variant: "primary", size: "sm" })}>
            Confier un bien
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {requests === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : requests && requests.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
            <HomeIcon size={16} /> Aucune demande envoyée pour l&apos;instant.
          </p>
        ) : requests ? (
          <div className="flex flex-col divide-y divide-border">
            {requests.map((r) => {
              const s = STATUS_BADGE[r.status];
              const Icon = s.icon;
              return (
                <div key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-label-md text-ink">
                      {r.requestType === "louer" ? "Mettre en location" : "Vendre"} — {r.address}
                    </p>
                    {r.description && <p className="text-body-sm text-ink-muted">{r.description}</p>}
                    <p className="text-body-xs text-ink-faint">Envoyée le {r.createdAt.slice(0, 10)}</p>
                  </div>
                  <Badge variant={s.variant}>
                    <Icon size={12} />
                    {s.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
