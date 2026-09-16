"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, FileDown, Wallet, Building2, ShieldCheck, Pencil, Percent, Link2, Copy, Check, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getOwner,
  updateOwner,
  createPayout,
  updateCommissionRate,
  generateOwnerPortalLink,
  statementPdfPath,
  type Owner,
  type OwnerProperty,
  type OwnerPayout,
  type CreatePayoutInput,
  type CommissionRate,
} from "@/lib/api/owners";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa, formatDateLabel, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { DocumentDownloadStatus } from "@/components/documents/document-download-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Attribution } from "@/components/ui/attribution";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useToast } from "@/lib/toast/toast-context";

const UNIT_STATUS_BADGE = {
  libre: { variant: "success" as const, label: "Libre" },
  loue: { variant: "neutral" as const, label: "Loué" },
  reserve: { variant: "warning" as const, label: "Réservé" },
};

const PAYMENT_METHODS: { value: CreatePayoutInput["paymentMethod"]; label: string }[] = [
  { value: "virement", label: "Virement" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "especes", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
];

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
  const { accessToken, user } = useAuth();
  // Enregistrer un versement est une action financière : ouverte au
  // comptable aussi (même logique que le registre des paiements locataires).
  const canPayout = user?.role === "dg" || (user?.permissions.includes("proprietaires") ?? false) || (user?.permissions.includes("comptabilite") ?? false);
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

  const [owner, setOwner] = React.useState<Owner | null>(null);
  const [properties, setProperties] = React.useState<OwnerProperty[] | null>(null);
  const [payouts, setPayouts] = React.useState<OwnerPayout[] | null>(null);
  const [activeCommissionRate, setActiveCommissionRate] = React.useState<CommissionRate | null>(null);
  const [commissionRates, setCommissionRates] = React.useState<CommissionRate[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editingOwner, setEditingOwner] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(ownerId)) return;
    getOwner(accessToken, ownerId)
      .then((res) => {
        setOwner(res.owner);
        setProperties(res.properties);
        setPayouts(res.payouts);
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
              {canManage && (
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

        {canManage && <PortalLinkCard owner={owner} accessToken={accessToken} onGenerated={load} />}

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
            isDg={user?.role === "dg"}
            activeRate={activeCommissionRate}
            rates={commissionRates}
            accessToken={accessToken}
            onUpdated={load}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Versements</CardTitle>
            <CardDescription>Historique des loyers nets reversés à ce propriétaire.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canPayout && (
              <PayoutForm ownerId={owner.id} ownerName={owner.name} accessToken={accessToken} onRecorded={load} />
            )}

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
      </div>
    </div>
  );
}

/**
 * Portail propriétaire (étape 13, idée n°1) : génère/régénère le lien secret
 * (sans mot de passe) donnant accès à sa recette du mois, son patrimoine et
 * l'historique de ses versements. Même révélation unique que le portail
 * locataire (`locataire-view.tsx`) et les identifiants d'un employé.
 */
function PortalLinkCard({
  owner,
  accessToken,
  onGenerated,
}: {
  owner: Owner;
  accessToken: string | null;
  onGenerated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<{ url: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function handleGenerate() {
    if (!accessToken) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateOwnerPortalLink(accessToken, owner.id);
      const url = `${window.location.origin}${res.path}`;
      setLink({ url });
      setOpen(true);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer le lien.");
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le lien reste visible pour une copie manuelle.
    }
  }

  const message = link
    ? [
        `Bonjour ${owner.name},`,
        `Voici votre espace personnel pour suivre la recette de vos biens et vos versements :`,
        link.url,
        `Ce lien est personnel, ne le partagez pas.`,
      ].join("\n")
    : "";
  const whatsappHref = link && owner.phone ? buildWhatsAppHref(owner.phone, message) : "#";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Portail propriétaire</CardTitle>
            <CardDescription>
              Lien personnel, sans mot de passe, pour que {owner.name} consulte sa recette et ses versements
              lui-même.
            </CardDescription>
            {owner.hasPortalLink && owner.portalLinkCreatedAt && !open && (
              <p className="mt-1 text-body-xs text-ink-faint">
                Lien généré le {new Date(owner.portalLinkCreatedAt).toLocaleDateString("fr-FR")}
              </p>
            )}
          </div>
          {!open && (
            <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
              <Link2 size={14} />
              {generating ? "Génération…" : owner.hasPortalLink ? "Régénérer le lien" : "Générer le lien"}
            </Button>
          )}
        </div>
      </CardHeader>
      {(error || (open && link)) && (
        <CardContent className="flex flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          {open && link && (
            <>
              {owner.hasPortalLink && (
                <p className="text-body-xs text-warning-fg">
                  L&apos;ancien lien vient d&apos;être invalidé — seul celui-ci fonctionne désormais.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
                <code className="truncate text-body-sm text-ink">{link.url}</code>
                <Button type="button" variant="ghost" size="sm" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copié" : "Copier"}
                </Button>
              </div>
              <p className="text-body-xs text-ink-muted">
                Ce lien ne sera plus affiché ensuite — envoyez-le maintenant, ou régénérez-en un autre plus tard.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {owner.phone ? (
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button type="button" variant="whatsapp" className="w-full">
                      <MessageCircle size={18} />
                      Envoyer par WhatsApp
                    </Button>
                  </a>
                ) : (
                  <span className="flex flex-1 items-center justify-center gap-2 rounded border border-border px-4 py-2 font-label-md text-ink-faint">
                    <MessageCircle size={18} />
                    Aucun numéro renseigné
                  </span>
                )}
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Fermer
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Formulaire de modification de la fiche propriétaire (nom, téléphone, email, adresse, notes). */
function EditOwnerForm({
  owner,
  accessToken,
  onSaved,
  onCancel,
}: {
  owner: Owner;
  accessToken: string | null;
  onSaved: (owner: Owner) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(owner.name);
  const [phone, setPhone] = React.useState(owner.phone ?? "");
  const [email, setEmail] = React.useState(owner.email ?? "");
  const [address, setAddress] = React.useState(owner.address ?? "");
  const [notes, setNotes] = React.useState(owner.notes ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!name.trim()) return setError("Le nom du propriétaire est obligatoire.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await updateOwner(accessToken, owner.id, {
        name: name.trim(),
        // Chaîne vide envoyée explicitement (pas `undefined`, sinon JSON.stringify
        // omet la clé et le champ ne serait jamais effacé côté serveur).
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      onSaved(res.owner);
      toast.success("Modifications enregistrées.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ces modifications.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modifier le propriétaire</CardTitle>
        <CardDescription>Le nom du propriétaire est obligatoire.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          <Field label="Nom" htmlFor="editOwnerName" required>
            <Input id="editOwnerName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Téléphone (optionnel)" htmlFor="editOwnerPhone" hint="Ex. 0161234567">
              <Input id="editOwnerPhone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email (optionnel)" htmlFor="editOwnerEmail">
              <Input id="editOwnerEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="Adresse (optionnel)" htmlFor="editOwnerAddress">
            <Input id="editOwnerAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Notes (optionnel)" htmlFor="editOwnerNotes">
            <Input id="editOwnerNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Enregistrer un versement est un mouvement d'argent réel vers un tiers :
 * un formulaire seul ne suffit pas. Après saisie, un écran de vérification
 * récapitule explicitement le propriétaire bénéficiaire (nom en toutes
 * lettres, jamais un simple identifiant) avant tout envoi — rien n'est
 * enregistré sans ce second geste explicite.
 */
function PayoutForm({
  ownerId,
  ownerName,
  accessToken,
  onRecorded,
}: {
  ownerId: number;
  ownerName: string;
  accessToken: string | null;
  onRecorded: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [amount, setAmount] = React.useState("");
  // La période est choisie dans un calendrier (jour inclus — primordial,
  // pas seulement le mois), jamais saisie à la main — le libellé français
  // ("6 juin 2026") en est simplement dérivé.
  const [periodDate, setPeriodDate] = React.useState("");
  const periodLabel = periodDate ? formatDateLabel(periodDate) : "";
  const [method, setMethod] = React.useState<CreatePayoutInput["paymentMethod"]>("virement");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
  const toast = useToast();

  function reset() {
    setOpen(false);
    setStep("form");
    setAmount("");
    setPeriodDate("");
    setNotes("");
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Montant invalide.");
    if (!periodDate) return setError("Période requise.");
    if (!paidAt) return setError("Date requise.");
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPayout(accessToken, ownerId, {
        amount: Number(amount),
        periodLabel,
        paidAt,
        paymentMethod: method,
        notes: notes.trim() || undefined,
      });
      const paidAmount = Number(amount);
      reset();
      onRecorded();
      toast.success(`Versement de ${formatFcfa(paidAmount)} enregistré pour ${ownerName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce versement.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Nouveau versement</span>
        <Button variant="success" size="sm" onClick={() => (open ? reset() : setOpen(true))}>
          <Wallet size={14} />
          {open ? "Fermer" : "Enregistrer un versement"}
        </Button>
      </div>

      {open && error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {open && step === "form" && (
        <form onSubmit={handleReview} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Période" htmlFor="periodDate" required hint="Date concernée par ce versement (le jour compte)">
              <Input id="periodDate" type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" htmlFor="payoutAmount" required>
              <Input id="payoutAmount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="payoutMethod" required>
              <select
                id="payoutMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as CreatePayoutInput["paymentMethod"])}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date du versement" htmlFor="payoutDate" required>
              <Input id="payoutDate" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="payoutNotes">
            <Input id="payoutNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" className="self-start">
            Vérifier le versement
          </Button>
        </form>
      )}

      {open && step === "confirm" && (
        <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-surface-muted p-4">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck size={18} />
            <span className="font-label-md">Vérifiez ce versement avant confirmation</span>
          </div>

          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            <ConfirmRow label="Propriétaire bénéficiaire" value={ownerName} strong />
            <ConfirmRow label="Montant" value={formatFcfa(Number(amount))} strong />
            <ConfirmRow label="Période concernée" value={periodLabel} />
            <ConfirmRow label="Mode de règlement" value={methodLabel} />
            <ConfirmRow label="Date du versement" value={paidAt} />
            {notes.trim() && <ConfirmRow label="Note" value={notes.trim()} />}
          </div>

          <p className="text-body-xs text-ink-muted">
            Cette action enregistre un versement réel dans l&apos;historique du propriétaire. Vérifiez le nom du
            bénéficiaire et le montant avant de confirmer.
          </p>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("form")} disabled={submitting}>
              Modifier
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Enregistrement…" : `Confirmer le versement à ${ownerName}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Taux de commission du cabinet sur la recette nette de chaque Bien de ce
 * propriétaire — DG uniquement pour la modification (cahier des charges).
 * Comme pour un versement, un changement de taux est un acte de gérance :
 * un écran de vérification récapitule l'ancien et le nouveau taux avant tout
 * envoi. Aucun taux n'est jamais écrasé, seulement clôturé puis remplacé —
 * l'historique complet reste affiché sous le formulaire.
 */
function CommissionCard({
  ownerId,
  ownerName,
  isDg,
  activeRate,
  rates,
  accessToken,
  onUpdated,
}: {
  ownerId: number;
  ownerName: string;
  isDg: boolean;
  activeRate: CommissionRate | null;
  rates: CommissionRate[];
  accessToken: string | null;
  onUpdated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [rate, setRate] = React.useState("");
  const [startsOn, setStartsOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  function reset() {
    setOpen(false);
    setStep("form");
    setError(null);
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) return setError("Le taux doit être compris entre 0 et 100.");
    if (!startsOn) return setError("Date de début requise.");
    if (activeRate && startsOn <= activeRate.startsOn) {
      return setError(`La date de début doit être postérieure au début du taux actif (${activeRate.startsOn}).`);
    }
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCommissionRate(accessToken, ownerId, { rate: Number(rate), startsOn });
      const newRate = Number(rate);
      reset();
      onUpdated();
      toast.success(`Nouveau taux de commission enregistré : ${newRate} %.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce taux.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commission du cabinet</CardTitle>
        <CardDescription>Taux appliqué sur la recette nette de chaque Bien de ce propriétaire.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          {activeRate ? (
            <div>
              <span className="font-display text-headline-md text-ink">{activeRate.rate} %</span>
              <p className="text-body-xs text-ink-muted">En vigueur depuis le {activeRate.startsOn}</p>
            </div>
          ) : (
            <p className="text-body-sm text-warning-fg">
              Aucun taux défini — 0 % appliqué par défaut dans les calculs de recette.
            </p>
          )}
          {isDg && (
            <Button variant="secondary" size="sm" onClick={() => (open ? reset() : setOpen(true))}>
              <Percent size={14} />
              {open ? "Fermer" : activeRate ? "Modifier le taux" : "Définir un taux"}
            </Button>
          )}
        </div>

        {open && error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {open && step === "form" && (
          <form onSubmit={handleReview} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nouveau taux (%)" htmlFor="commissionRate" required hint="Entre 0 et 100">
                <Input
                  id="commissionRate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </Field>
              <Field
                label="À partir du"
                htmlFor="commissionStartsOn"
                required
                hint="Le taux précédent sera clôturé la veille"
              >
                <Input id="commissionStartsOn" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" className="self-start">
              Vérifier le nouveau taux
            </Button>
          </form>
        )}

        {open && step === "confirm" && (
          <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-surface-muted p-4">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck size={18} />
              <span className="font-label-md">Vérifiez ce changement avant confirmation</span>
            </div>

            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              <ConfirmRow label="Propriétaire" value={ownerName} strong />
              <ConfirmRow label="Nouveau taux" value={`${rate} %`} strong />
              <ConfirmRow label="En vigueur à partir du" value={formatDateLabel(startsOn)} />
              {activeRate && <ConfirmRow label="Ancien taux (clôturé la veille)" value={`${activeRate.rate} %`} />}
            </div>

            <p className="text-body-xs text-ink-muted">
              L&apos;ancien taux n&apos;est jamais effacé : les recettes déjà calculées pour les mois passés
              resteront basées sur le taux qui était alors en vigueur.
            </p>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("form")} disabled={submitting}>
                Modifier
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Confirmer le nouveau taux"}
              </Button>
            </div>
          </div>
        )}

        {rates.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-label-sm uppercase tracking-wider text-ink-muted">Historique des taux</span>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Taux</TableHead>
                  <TableHead>Début</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Défini par</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.rate} %</TableCell>
                    <TableCell className="text-ink-soft">{r.startsOn}</TableCell>
                    <TableCell className="text-ink-soft">
                      {r.endsOn ?? <Badge variant="success">Actif</Badge>}
                    </TableCell>
                    <TableCell className="text-ink-soft">
                      {r.setBy ? `${r.setBy.name} (${r.setBy.roleLabel})` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="text-body-sm text-ink-soft">{label}</span>
      <span className={cn("text-right text-body-sm", strong ? "font-label-md text-ink" : "text-ink")}>{value}</span>
    </div>
  );
}
