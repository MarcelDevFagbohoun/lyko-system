"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Tag } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  listSaleProperties,
  createSaleProperty,
  SALE_PROPERTY_TYPE_LABELS,
  SALE_PROPERTY_STATUS_LABELS,
  type SaleProperty,
  type SalePropertyType,
} from "@/lib/api/sale-properties";
import { OwnerPicker } from "@/components/properties/owner-picker";
import type { OwnerListItem } from "@/lib/api/owners";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

/**
 * « Biens à vendre » (demande utilisateur, 2026-10-18) : catalogue interne (jamais publié
 * publiquement pour l'instant) des maisons/terrains que le cabinet est chargé de vendre. Gardée à
 * part des Biens locatifs (`/espace/biens`) — pas d'unité, pas de loyer, juste un prix et un suivi de
 * statut. Accès réservé aux employés à qui le DG a explicitement accordé la permission
 * `biens_a_vendre` (jamais pré-cochée), voir `components/espace/espace-sidebar.tsx`.
 */
export function BiensAVendreView() {
  return (
    <RequireAuth permission="biens_a_vendre">
      <BiensAVendreContent />
    </RequireAuth>
  );
}

const STATUS_BADGE: Record<string, "success" | "warning" | "info" | "neutral" | "danger"> = {
  en_vente: "info",
  en_negociation: "warning",
  vendu: "success",
  retire: "neutral",
};

function BiensAVendreContent() {
  const { accessToken } = useAuth();
  const [items, setItems] = React.useState<SaleProperty[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listSaleProperties(accessToken)
      .then((res) => setItems(res.saleProperties))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les biens à vendre."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Biens à vendre</h1>
            <p className="text-body-md text-ink-soft">
              Maisons, terrains… que l&apos;entreprise est chargée de vendre — suivi interne, prix, détails, photos.
            </p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={18} />
            {showForm ? "Fermer" : "Nouveau bien à vendre"}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {showForm && (
          <NewSalePropertyForm
            accessToken={accessToken}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {items === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : items && items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Tag size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucun bien à vendre pour le moment</p>
            </CardContent>
          </Card>
        ) : items ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Bien</TableHead>
                <TableHead>Propriétaire</TableHead>
                <TableHead className="text-right">Prix</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-label-md text-ink">{s.title}</div>
                    <div className="text-body-xs text-ink-muted">
                      {s.typeLabel}
                      {s.address ? ` · ${s.address}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-ink-soft">
                    {s.owner ? s.owner.name : <span className="text-ink-muted">—</span>}
                  </TableCell>
                  <TableAmount>{formatFcfa(s.price)}</TableAmount>
                  <TableCell className="text-center">
                    <Badge variant={STATUS_BADGE[s.status] ?? "neutral"}>{SALE_PROPERTY_STATUS_LABELS[s.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/espace/biens-a-vendre/${s.id}`}>
                      <Button variant="ghost" size="sm">
                        Voir le détail
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}

function NewSalePropertyForm({ accessToken, onCreated }: { accessToken: string | null; onCreated: () => void }) {
  const [type, setType] = React.useState<SalePropertyType>("villa");
  const [title, setTitle] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [surfaceM2, setSurfaceM2] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedOwner, setSelectedOwner] = React.useState<OwnerListItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    const priceNum = Number(price);
    if (!title.trim()) return setError("Titre requis.");
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setError("Prix invalide.");

    setSubmitting(true);
    setError(null);
    try {
      await createSaleProperty(accessToken, {
        type,
        title: title.trim(),
        address: address.trim() || undefined,
        price: priceNum,
        surfaceM2: surfaceM2 ? Number(surfaceM2) : undefined,
        description: description.trim() || undefined,
        ownerId: selectedOwner?.id,
      });
      toast.success("Bien à vendre créé.");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce bien.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Bug corrigé (signalé par l'utilisateur, capture d'écran, 2026-10-18) : `Card` anime son
    // apparition (`animate-card-in`), ce qui lui crée SA PROPRE pile d'empilement CSS même sans
    // `position`. Cette carte et la carte « Aucun bien à vendre » plus bas sont toutes deux des
    // enfants directs du conteneur flex de la page, donc à égalité de z-index (auto) — sans ce
    // `z-10` explicite, la carte suivante (plus bas dans le DOM) passait PAR-DESSUS tout le contenu
    // de celle-ci, y compris le menu déroulant du sélecteur de propriétaire (pourtant en `z-20` en
    // interne : ce z-index ne vaut que DANS la pile de cette carte, qui perdait entièrement face à
    // la pile de la carte suivante). `z-10` suffit : au-dessus de n'importe quel frère en `auto`.
    <Card className="relative z-10">
      <CardHeader>
        <CardTitle>Nouveau bien à vendre</CardTitle>
        <CardDescription>Les photos s&apos;ajoutent ensuite, depuis la fiche du bien.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="type" required>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as SalePropertyType)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {Object.entries(SALE_PROPERTY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Titre" htmlFor="title" required>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Villa 4 chambres à Calavi" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Prix (FCFA)" htmlFor="price" required>
              <Input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Surface (m², optionnel)" htmlFor="surfaceM2">
              <Input id="surfaceM2" inputMode="decimal" value={surfaceM2} onChange={(e) => setSurfaceM2(e.target.value)} />
            </Field>
            <Field label="Adresse (optionnel)" htmlFor="address">
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
          <Field label="Description (optionnel)" htmlFor="description">
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </Field>
          <div>
            <p className="mb-1.5 font-label-sm text-ink-soft">Propriétaire (optionnel)</p>
            <OwnerPicker accessToken={accessToken} selectedOwner={selectedOwner} onSelect={setSelectedOwner} />
          </div>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Création…" : "Créer le bien à vendre"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
