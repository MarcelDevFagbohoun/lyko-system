"use client";

import * as React from "react";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  LogOut,
} from "lucide-react";
import { useCan } from "@/lib/auth/use-can";
import { getGlSettings } from "@/lib/api/gl";
import { ApiError } from "@/lib/api/client";
import {
  listSuppliers,
  getAccountingMeta,
  listFixedAssets,
  createFixedAsset,
  payFixedAsset,
  depreciateFixedAsset,
  disposeFixedAsset,
  getFixedAsset,
  type Supplier,
  type FixedAsset,
  type FixedAssetCategory,
  type FixedAssetDepreciationEntry,
} from "@/lib/api/accounting";
import type { PaymentMethod } from "@/lib/api/renters";
import { FIXED_ASSET_CATEGORY_LABELS } from "@/lib/constants/fixedAssets";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
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
import { useToast } from "@/lib/toast/toast-context";
import { todayIso } from "@/lib/dates";
import { PAYMENT_METHODS, currentYearMonth } from "./shared";

// Registre des immobilisations du cabinet (matériel propre à l'agence — jamais
// les Biens gérés pour le compte des propriétaires). Contrairement au journal
// des dépenses, ce registre n'est PAS filtré par la période sélectionnée en
// haut de page : une immobilisation vit sur plusieurs années, elle reste donc
// toujours visible en entier, comme le journal des suppressions.
export function FixedAssetsSection({ accessToken }: { accessToken: string | null }) {
  const canRecordExpense = useCan("depenses_enregistrer");
  const [assets, setAssets] = React.useState<FixedAsset[] | null>(null);
  const [categories, setCategories] = React.useState<{ key: FixedAssetCategory; label: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    Promise.all([listFixedAssets(accessToken), getAccountingMeta(accessToken)])
      .then(([res, meta]) => {
        setAssets(res.fixedAssets);
        setCategories(meta.fixedAssetCategories);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les immobilisations."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  const totalBookValue = assets?.reduce((sum, a) => sum + a.bookValue, 0) ?? 0;

  return (
    <Card className="border-info-border bg-info/5">
      <CardHeader>
        <CardTitle>Immobilisations de l&apos;entreprise</CardTitle>
        <CardDescription>
          Matériel propre à l&apos;agence (informatique, mobilier, véhicules) — jamais les Biens gérés pour le
          compte des propriétaires. La valeur nette reflète uniquement les mois d&apos;amortissement déjà
          enregistrés, jamais une estimation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {canRecordExpense && <FixedAssetForm accessToken={accessToken} categories={categories} onCreated={load} />}

        {assets === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : assets.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune immobilisation enregistrée.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Acquisition</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                  <TableHead className="text-right">Valeur nette</TableHead>
                  <TableHead>Règlement</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <FixedAssetRow key={a.id} asset={a} accessToken={accessToken} onChanged={load} />
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="font-label-md text-ink">Valeur nette totale du parc</span>
              <span className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(totalBookValue)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function FixedAssetForm({
  accessToken,
  categories,
  onCreated,
}: {
  accessToken: string | null;
  categories: { key: FixedAssetCategory; label: string }[];
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [category, setCategory] = React.useState<FixedAssetCategory>("informatique");
  const [acquisitionDate, setAcquisitionDate] = React.useState(todayIso());
  const [acquisitionCost, setAcquisitionCost] = React.useState("");
  const [usefulLifeYears, setUsefulLifeYears] = React.useState("3");
  const [paymentStatus, setPaymentStatus] = React.useState<"paid" | "unpaid">("paid");
  const [method, setMethod] = React.useState<PaymentMethod>("especes");
  const [supplierName, setSupplierName] = React.useState("");
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey();

  React.useEffect(() => {
    if (!accessToken || !open) return;
    listSuppliers(accessToken).then((res) => setSuppliers(res.suppliers));
  }, [accessToken, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createFixedAsset(accessToken, {
        label: label.trim(),
        category,
        acquisitionDate,
        acquisitionCost: Number(acquisitionCost),
        usefulLifeYears: Number(usefulLifeYears),
        paymentStatus,
        paymentMethod: paymentStatus === "paid" ? method : undefined,
        supplierName: paymentStatus === "unpaid" ? supplierName.trim() : undefined,
        idempotencyKey: idem.key,
      });
      idem.renew();
      setOpen(false);
      setLabel("");
      setAcquisitionCost("");
      setSupplierName("");
      onCreated();
      toast.success(paymentStatus === "unpaid" ? "Immobilisation à crédit enregistrée." : "Immobilisation enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette immobilisation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouvelle immobilisation</span>
        <Button variant="info" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} />
          {open ? "Fermer" : "Enregistrer une immobilisation"}
        </Button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Libellé" htmlFor="faLabel" required hint="Ex. 3 ordinateurs portables, véhicule de service...">
              <Input id="faLabel" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Catégorie" htmlFor="faCategory" required>
              <select
                id="faCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as FixedAssetCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date d'acquisition" htmlFor="faDate" required>
              <Input id="faDate" type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
            </Field>
            <Field label="Coût d'acquisition (FCFA)" htmlFor="faCost" required>
              <Input
                id="faCost"
                inputMode="numeric"
                value={acquisitionCost}
                onChange={(e) => setAcquisitionCost(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Durée d'amortissement (années)" htmlFor="faLife" required hint="Ex. 3 pour de l'informatique">
              <Input
                id="faLife"
                inputMode="numeric"
                value={usefulLifeYears}
                onChange={(e) => setUsefulLifeYears(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-label-sm text-ink-soft">Règlement</span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant={paymentStatus === "paid" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setPaymentStatus("paid")}
              >
                Payée maintenant
              </Button>
              <Button
                type="button"
                variant={paymentStatus === "unpaid" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setPaymentStatus("unpaid")}
              >
                À crédit (fournisseur)
              </Button>
            </div>
          </div>
          {paymentStatus === "paid" ? (
            <Field label="Mode de règlement" htmlFor="faMethod" required>
              <select
                id="faMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Fournisseur" htmlFor="faSupplier" required hint="Nouveau ou déjà connu">
              <Input id="faSupplier" list="faSupplierSuggestions" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <datalist id="faSupplierSuggestions">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </Field>
          )}
          <Button
            type="submit"
            disabled={
              submitting ||
              !label.trim() ||
              !acquisitionCost ||
              !usefulLifeYears ||
              (paymentStatus === "unpaid" && !supplierName.trim())
            }
            className="self-start"
          >
            {submitting ? "Enregistrement…" : "Enregistrer l'immobilisation"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function FixedAssetRow({
  asset,
  accessToken,
  onChanged,
}: {
  asset: FixedAsset;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const canRecord = useCan("depenses_enregistrer");
  const [settling, setSettling] = React.useState(false);
  const [settleMethod, setSettleMethod] = React.useState<PaymentMethod>("especes");
  const [settlePaidAt, setSettlePaidAt] = React.useState(todayIso());
  const [depreciating, setDepreciating] = React.useState(false);
  const [period, setPeriod] = React.useState(currentYearMonth());
  const [disposing, setDisposing] = React.useState(false);
  const [disposedAt, setDisposedAt] = React.useState(todayIso());
  const [disposeReason, setDisposeReason] = React.useState("");
  const [saleAllowed, setSaleAllowed] = React.useState(false);
  const [salePrice, setSalePrice] = React.useState("");
  const [saleMethod, setSaleMethod] = React.useState<"especes" | "mobile_money" | "virement" | "cheque">("virement");
  const [expanded, setExpanded] = React.useState(false);
  const [depreciations, setDepreciations] = React.useState<FixedAssetDepreciationEntry[] | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSettle() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payFixedAsset(accessToken, asset.id, { paymentMethod: settleMethod, paidAt: settlePaidAt });
      setSettling(false);
      onChanged();
      toast.success(`« ${asset.label} » réglée.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDepreciate() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await depreciateFixedAsset(accessToken, asset.id, period);
      setDepreciating(false);
      onChanged();
      toast.success(`Amortissement de ${formatFcfa(res.amount)} enregistré pour ${period}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cet amortissement.");
    } finally {
      setSubmitting(false);
    }
  }

  // Prix de vente proposé seulement si l'option est activée (réglage lisible par DG/comptable).
  React.useEffect(() => {
    if (!disposing || !accessToken) return;
    getGlSettings(accessToken)
      .then((s) => setSaleAllowed(s.assetSaleProceeds))
      .catch(() => setSaleAllowed(false));
  }, [disposing, accessToken]);

  async function handleDispose() {
    if (!accessToken || !disposeReason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await disposeFixedAsset(accessToken, asset.id, {
        disposedAt,
        reason: disposeReason.trim(),
        ...(saleAllowed && Number(salePrice) > 0 ? { salePrice: Number(salePrice), salePaymentMethod: saleMethod } : {}),
      });
      setDisposing(false);
      onChanged();
      toast.success(`« ${asset.label} » sortie du patrimoine.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de sortir cette immobilisation.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !depreciations && accessToken) {
      const res = await getFixedAsset(accessToken, asset.id);
      setDepreciations(res.depreciations);
    }
  }

  const fullyDepreciated = asset.bookValue <= 0;

  if (settling) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Régler « {asset.label} » ({formatFcfa(asset.acquisitionCost)}) dû à {asset.supplierName} ?
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={settleMethod}
                onChange={(e) => setSettleMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Input type="date" value={settlePaidAt} onChange={(e) => setSettlePaidAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSettle} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSettling(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (depreciating) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Enregistrer un mois d&apos;amortissement pour « {asset.label} » (valeur nette actuelle :{" "}
              {formatFcfa(asset.bookValue)}) ?
            </p>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
              />
              <Button size="sm" onClick={handleDepreciate} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Confirmer l'amortissement"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDepreciating(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (disposing) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex flex-col gap-2 py-2">
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <p className="text-body-sm text-ink">
              Sortir « {asset.label} » du patrimoine (vente, rebut, perte) ? Action définitive — la valeur nette
              comptable résiduelle ({formatFcfa(asset.bookValue)}) sera passée en charge.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input type="date" value={disposedAt} onChange={(e) => setDisposedAt(e.target.value)} />
              <Input
                value={disposeReason}
                onChange={(e) => setDisposeReason(e.target.value)}
                placeholder="Motif (ex. volé, revendu, hors d'usage)"
              />
            </div>
            {saleAllowed && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  inputMode="numeric"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value.replace(/\D/g, ""))}
                  placeholder="Prix de vente encaissé (FCFA), si vendu"
                />
                {Number(salePrice) > 0 && (
                  <select
                    value={saleMethod}
                    onChange={(e) => setSaleMethod(e.target.value as typeof saleMethod)}
                    className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="Mode d'encaissement du prix"
                  >
                    <option value="virement">Virement</option>
                    <option value="cheque">Chèque</option>
                    <option value="especes">Espèces</option>
                    <option value="mobile_money">Mobile Money</option>
                  </select>
                )}
                {Number(salePrice) > 0 && (
                  <p className="text-body-xs text-ink-muted sm:col-span-2">
                    {Number(salePrice) >= asset.bookValue ? "Plus-value" : "Moins-value"} estimée : {formatFcfa(Math.abs(Number(salePrice) - asset.bookValue))}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={handleDispose} disabled={submitting || !disposeReason.trim()}>
                {submitting ? "Enregistrement…" : "Confirmer la sortie"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDisposing(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <button
            type="button"
            onClick={toggleExpanded}
            className="inline-flex items-center gap-1.5 text-left text-ink hover:underline"
          >
            {expanded ? <ChevronUp size={14} className="text-ink-muted" /> : <ChevronDown size={14} className="text-ink-muted" />}
            {asset.label}
          </button>
          {asset.status === "disposed" && <Badge variant="neutral" className="ml-1.5">Sortie</Badge>}
        </TableCell>
        <TableCell className="text-ink-soft">{FIXED_ASSET_CATEGORY_LABELS[asset.category]}</TableCell>
        <TableCell className="text-ink-soft">{asset.acquisitionDate}</TableCell>
        <TableAmount>{formatFcfa(asset.acquisitionCost)}</TableAmount>
        <TableAmount>{formatFcfa(asset.bookValue)}</TableAmount>
        <TableCell className="text-ink-soft">
          {asset.paymentStatus === "unpaid" ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="warning">À crédit</Badge>
              <span>{asset.supplierName}</span>
            </div>
          ) : (
            asset.paymentMethodLabel
          )}
        </TableCell>
        <TableCell className="text-right">
          {canRecord && <div className="flex items-center justify-end gap-1">
            {asset.paymentStatus === "unpaid" && (
              <Button variant="warning" size="sm" onClick={() => setSettling(true)}>
                Régler
              </Button>
            )}
            {!fullyDepreciated && (
              <Button variant="secondary" size="sm" onClick={() => setDepreciating(true)}>
                Amortir
              </Button>
            )}
            {asset.status !== "disposed" && (
              <Button variant="ghost" size="sm" onClick={() => setDisposing(true)} aria-label="Sortir du patrimoine">
                <LogOut size={14} className="text-danger-fg" />
              </Button>
            )}
          </div>}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7}>
            <div className="flex flex-col gap-1.5 py-2">
              {asset.status === "disposed" && (
                <p className="text-body-sm text-ink-soft">
                  Sortie du patrimoine le {asset.disposedAt} — {asset.disposedReason}
                </p>
              )}
              {depreciations === null ? (
                <p className="text-body-sm text-ink-muted">Chargement…</p>
              ) : depreciations.length === 0 ? (
                <p className="text-body-sm text-ink-muted">Aucun amortissement enregistré pour l&apos;instant.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {depreciations.map((d) => (
                    <li key={d.period} className="flex items-center justify-between gap-3 text-body-xs text-ink-soft">
                      <span>{d.period}</span>
                      <span className="tabular">{formatFcfa(d.amount)}</span>
                      <span className="text-ink-muted">
                        {d.recordedBy ? `${d.recordedBy.name} (${d.recordedBy.roleLabel})` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
