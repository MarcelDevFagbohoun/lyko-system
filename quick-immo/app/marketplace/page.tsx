"use client";

import * as React from "react";
import { Home as HomeIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getPublicMarketplace, type PublicMarketplace } from "@/lib/api/marketplace";
import { addFavorite, listFavorites, removeFavorite } from "@/lib/api/accounts";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ListingCard } from "@/components/listing-card";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";

export default function MarketplacePage() {
  const { account, accessToken, status } = useAuth();
  const [data, setData] = React.useState<PublicMarketplace | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = React.useState<Set<number>>(new Set());
  const toast = useToast();

  React.useEffect(() => {
    getPublicMarketplace()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les annonces."));
  }, []);

  const loadFavorites = React.useCallback(() => {
    if (!accessToken || account?.role !== "chercheur") return;
    listFavorites(accessToken)
      .then((res) => setFavoriteIds(new Set(res.favorites.map((f) => f.unitId))))
      .catch(() => {
        // Favoris non essentiels à l'affichage : une erreur ici ne bloque jamais la page.
      });
  }, [accessToken, account]);

  React.useEffect(() => loadFavorites(), [loadFavorites]);

  async function toggleFavorite(unitId: number) {
    if (!accessToken) return;
    try {
      if (favoriteIds.has(unitId)) {
        await removeFavorite(accessToken, unitId);
        toast.success("Retiré de vos favoris.");
      } else {
        await addFavorite(accessToken, unitId);
        toast.success("Ajouté à vos favoris.");
      }
      loadFavorites();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de mettre à jour vos favoris.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />

      <section className="border-b border-border bg-primary-bg">
        <div className="content-shell flex flex-col items-center gap-4 py-14 text-center">
          <h1 className="font-display text-headline-2xl text-ink">Toutes les annonces</h1>
          <p className="max-w-xl text-body-lg text-ink-soft">
            Des biens vérifiés, gérés par nos agences partenaires — louez en toute simplicité.
          </p>
        </div>
      </section>

      <main className="flex-1">
        <div className="content-shell flex flex-col gap-6 py-10">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}

          {!error && (
            <p className="text-body-md text-ink-soft">
              {data === null
                ? "Chargement…"
                : data.listings.length === 0
                  ? "Aucun bien disponible pour le moment."
                  : `${data.listings.length} bien(s) actuellement disponible(s) à la location.`}
            </p>
          )}

          {data && data.listings.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <HomeIcon size={28} className="text-ink-faint" />
                <p className="text-body-sm text-ink-muted">
                  Revenez bientôt, ou contactez-nous pour connaître les prochaines disponibilités.
                </p>
              </CardContent>
            </Card>
          )}

          {data && data.listings.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.listings.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  tenantPhone={data.tenant.phone}
                  isFavorite={favoriteIds.has(l.unitId)}
                  canFavorite={status === "authenticated" && account?.role === "chercheur"}
                  onToggleFavorite={() => toggleFavorite(l.unitId)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
