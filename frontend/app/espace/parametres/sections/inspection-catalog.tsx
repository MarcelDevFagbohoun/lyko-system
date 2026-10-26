"use client";

import * as React from "react";
import {
  Receipt,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  type CatalogItem,
} from "@/lib/api/inspectionCatalog";
import { formatFcfa } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { CADRES } from "@/lib/module-theme";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Référentiel de prix pour la facturation des dégradations à l'état des
 * lieux de sortie (demande directe de l'utilisateur) — un catalogue commun
 * à toute l'entreprise, réutilisé à chaque sortie de locataire. Prix tout
 * compris (matériel + main d'œuvre), décision explicite. Gestion réservée
 * au DG (comme le taux de commission) ; la lecture (pour choisir un prix
 * pendant une sortie) reste ouverte à qui a la permission "États des lieux".
 */
export function InspectionCatalogSection({ accessToken }: { accessToken: string | null }) {
  const [items, setItems] = React.useState<CatalogItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listCatalogItems(accessToken)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le catalogue."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleDelete(id: number) {
    if (!accessToken) return;
    try {
      await deleteCatalogItem(accessToken, id);
      toast.success("Élément supprimé du catalogue.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Receipt size={18} className={CADRES.finances.text} />
          <CardTitle>Catalogue de facturation (états des lieux)</CardTitle>
        </div>
        <CardDescription>
          Prix des éléments de la maison (porte, fenêtre, robinetterie…), tout compris (matériel et pose) —
          proposés automatiquement à l&apos;agent quand un élément se dégrade entre l&apos;entrée et la sortie
          d&apos;un locataire.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {adding && (
          <CatalogItemForm
            accessToken={accessToken}
            onDone={() => {
              setAdding(false);
              load();
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {items === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : items.length === 0 && !adding ? (
          <p className="text-body-sm text-ink-muted">Aucun élément dans le catalogue pour l&apos;instant.</p>
        ) : (
          items.length > 0 && (
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Élément</TableHead>
                  <TableHead className="text-right">Prix (FCFA)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {items.map((it) =>
                  editingId === it.id ? (
                    <tr key={it.id}>
                      <td colSpan={3} className="p-2">
                        <CatalogItemForm
                          accessToken={accessToken}
                          initial={it}
                          onDone={() => {
                            setEditingId(null);
                            load();
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <TableRow key={it.id}>
                      <TableCell>{it.label}</TableCell>
                      <TableAmount>{formatFcfa(it.price)}</TableAmount>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(it.id)} className="text-ink-muted hover:text-ink">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => handleDelete(it.id)} className="text-ink-muted hover:text-danger-fg">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )
        )}

        {!adding && (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Ajouter un élément
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function CatalogItemForm({
  accessToken,
  initial,
  onDone,
  onCancel,
}: {
  accessToken: string | null;
  initial?: CatalogItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [price, setPrice] = React.useState(initial ? String(initial.price) : "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    const priceNumber = Number(price);
    if (!label.trim() || !Number.isFinite(priceNumber) || priceNumber <= 0) {
      setError("Libellé et prix (supérieur à 0) requis.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (initial) {
        await updateCatalogItem(accessToken, initial.id, { label: label.trim(), price: priceNumber });
        toast.success("Élément modifié.");
      } else {
        await createCatalogItem(accessToken, { label: label.trim(), price: priceNumber });
        toast.success("Élément ajouté au catalogue.");
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cet élément.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong bg-surface-muted p-3 sm:flex-row sm:items-end">
      {error && <p className="text-body-sm text-danger-fg sm:basis-full">{error}</p>}
      <div className="flex-1">
        <label className="mb-1 block text-body-xs text-ink-muted">Libellé</label>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Porte intérieure" />
      </div>
      <div className="w-full sm:w-40">
        <label className="mb-1 block text-body-xs text-ink-muted">Prix (FCFA, tout compris)</label>
        <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Enregistrement…" : initial ? "Enregistrer" : "Ajouter"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>
    </form>
  );
}

