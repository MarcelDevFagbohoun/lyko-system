"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Send, FileCheck2, DoorOpen, LogOut, Receipt, FileDown, Pencil, AlertTriangle, Plus, Link2, Copy, Check, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getRenter,
  updateRenter,
  createLease,
  createPayment,
  generatePortalLink,
  receiptPdfPath,
  certificatePdfPath,
  moveOutReportPdfPath,
  type Renter,
  type Lease,
  type PaymentMethod,
} from "@/lib/api/renters";
import type { Unit } from "@/lib/api/properties";
import { listComplaints, type Complaint } from "@/lib/api/complaints";
import { COMPLAINT_STATUS_LABELS } from "@/lib/constants/complaints";
import { listCharges, type UtilityCharge } from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, CHARGE_STATUS_LABELS } from "@/lib/constants/charges";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa, buildRentReminderMessage, previewRentAllocation, monthLabelFr } from "@/lib/utils";
import { PROPERTY_TYPE_LABELS } from "@/lib/constants/properties";
import { useToast } from "@/lib/toast/toast-context";
import { RequireAuth } from "@/components/auth/require-auth";
import { DocumentDownloadStatus } from "@/components/documents/document-download-status";
import { PropertyUnitPicker } from "@/components/properties/property-unit-picker";
import { Attribution } from "@/components/ui/attribution";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

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
  const canManage = user?.role === "dg" || (user?.permissions.includes("locataires") ?? false);
  // Documents financiers (attestation) : réservés à qui gère la relation
  // locataire ou à la comptabilité — la fiche elle-même est désormais
  // consultable par tout employé, mais pas la génération de documents.
  const canReadDocs = canManage || (user?.permissions.includes("comptabilite") ?? false);
  // PV de sortie : document généré par le module États des lieux, réservé à
  // sa propre permission (le serveur le refuse sinon).
  const canReadMoveOutPdf = user?.role === "dg" || (user?.permissions.includes("etats_des_lieux") ?? false);

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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => accessToken && openAuthenticatedPdf(certificatePdfPath(renter.id), accessToken)}
                >
                  <FileCheck2 size={16} />
                  Attestation de loyer
                </Button>
              )}
              {canReadDocs && activeLease && (
                <DocumentDownloadStatus
                  documentType="attestation"
                  referenceId={activeLease.id}
                  accessToken={accessToken}
                  isDg={isDg}
                />
              )}
            </div>
          )}
        </div>
        )}

        {canManage && <PortalLinkCard renter={renter} accessToken={accessToken} onGenerated={load} />}

        {activeLease ? (
          <LeaseCard lease={activeLease} renterId={renter.id} accessToken={accessToken} canManage={canManage} canReadDocs={canReadDocs} isDg={isDg} onChanged={load} />
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
              {pastLeases.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-label-md text-ink">
                      {l.unit.designationLabel} ({l.unit.code})
                    </p>
                    <p className="text-body-xs text-ink-muted">
                      {l.startDate} → {l.endDate ?? "—"} · {formatFcfa(l.monthlyRent)}
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
              ))}
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
 * paiements/quittances, son solde, son attestation, et le signalement d'un
 * incident. Même logique de révélation unique que les identifiants d'un
 * employé (`app/espace/employes/nouveau`) : le token n'est affiché qu'une
 * fois ici, jamais ré-affichable ensuite (seul son empreinte est stockée).
 */
function PortalLinkCard({
  renter,
  accessToken,
  onGenerated,
}: {
  renter: Renter;
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
      const res = await generatePortalLink(accessToken, renter.id);
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
        `Bonjour ${renter.firstName},`,
        `Voici votre espace personnel pour suivre vos paiements de loyer et vos quittances :`,
        link.url,
        `Ce lien est personnel, ne le partagez pas.`,
      ].join("\n")
    : "";
  const whatsappHref = link ? buildWhatsAppHref(renter.phone, message) : "#";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Portail locataire</CardTitle>
            <CardDescription>
              Lien personnel, sans mot de passe, pour que {renter.firstName} consulte ses paiements et signale un
              incident lui-même.
            </CardDescription>
            {renter.hasPortalLink && renter.portalLinkCreatedAt && !open && (
              <p className="mt-1 text-body-xs text-ink-faint">
                Lien généré le {new Date(renter.portalLinkCreatedAt).toLocaleDateString("fr-FR")}
              </p>
            )}
          </div>
          {!open && (
            <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
              <Link2 size={14} />
              {generating
                ? "Génération…"
                : renter.hasPortalLink
                  ? "Régénérer le lien"
                  : "Générer le lien"}
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
              {renter.hasPortalLink && (
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
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button type="button" variant="whatsapp" className="w-full">
                    <MessageCircle size={18} />
                    Envoyer par WhatsApp
                  </Button>
                </a>
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

/** Formulaire de modification de l'identité du locataire (nom, email, profession, notes). */
function EditRenterForm({
  renter,
  accessToken,
  onSaved,
  onCancel,
}: {
  renter: Renter;
  accessToken: string | null;
  onSaved: (renter: Renter) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = React.useState(renter.firstName);
  const [lastName, setLastName] = React.useState(renter.lastName);
  const [email, setEmail] = React.useState(renter.email ?? "");
  const [profession, setProfession] = React.useState(renter.profession ?? "");
  const [notes, setNotes] = React.useState(renter.notes ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!firstName.trim() || !lastName.trim()) return setError("Prénom et nom requis.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await updateRenter(accessToken, renter.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        // Chaîne vide envoyée explicitement (le schéma serveur ne reconnaît
        // pas `null`, seulement une chaîne vide, qu'il transforme lui-même) —
        // `undefined` serait pire : JSON.stringify l'omettrait et le champ ne
        // serait jamais effacé.
        email: email.trim(),
        profession: profession.trim(),
        notes: notes.trim(),
      });
      onSaved(res.renter);
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
        <CardTitle>Modifier le locataire</CardTitle>
        <CardDescription>
          Le numéro de téléphone ({renter.phone}) sert d&apos;identifiant et n&apos;est pas modifiable ici.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="editFirstName" required>
              <Input id="editFirstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Nom" htmlFor="editLastName" required>
              <Input id="editLastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email (optionnel)" htmlFor="editEmail">
              <Input id="editEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Profession (optionnel)" htmlFor="editProfession">
              <Input id="editProfession" value={profession} onChange={(e) => setProfession(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optionnel)" htmlFor="editNotes">
            <Input id="editNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
 * Affiché quand un locataire n'a plus de bail actif (parti, ou jamais
 * installé après création). Permet de lui attribuer une nouvelle unité —
 * sans ce formulaire, un locataire libéré restait bloqué sans issue.
 */
function NewLeaseCard({
  renterId,
  accessToken,
  onCreated,
}: {
  renterId: number;
  accessToken: string | null;
  onCreated: () => void;
}) {
  const [selectedUnit, setSelectedUnit] = React.useState<Unit | null>(null);
  const [monthlyRent, setMonthlyRent] = React.useState("");
  const [depositAmount, setDepositAmount] = React.useState("");
  const [rentDueDay, setRentDueDay] = React.useState("5");
  const [startDate, setStartDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  function handleSelectUnit(unit: Unit) {
    setSelectedUnit(unit);
    if (!monthlyRent) setMonthlyRent(String(unit.monthlyRent));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !selectedUnit) return;
    const rent = Number(monthlyRent);
    const deposit = Number(depositAmount || "0");
    const day = Number(rentDueDay);
    if (!Number.isFinite(rent) || rent <= 0) return setError("Loyer invalide.");
    if (!Number.isFinite(deposit) || deposit < 0) return setError("Caution invalide.");
    if (!Number.isInteger(day) || day < 1 || day > 28) return setError("Jour d'échéance entre 1 et 28.");
    if (!startDate) return setError("Date d'entrée requise.");

    setSubmitting(true);
    setError(null);
    try {
      await createLease(accessToken, renterId, {
        unitId: selectedUnit.id,
        monthlyRent: rent,
        depositAmount: deposit,
        rentDueDay: day,
        startDate,
      });
      onCreated();
      toast.success("Nouveau bail créé.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer ce bail.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attribuer une nouvelle unité</CardTitle>
        <CardDescription>
          Ce locataire n&apos;a pas de bail actif. Sélectionnez une unité libre pour démarrer un nouveau bail.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}

          <PropertyUnitPicker accessToken={accessToken} selectedUnit={selectedUnit} onSelect={handleSelectUnit} />
          {selectedUnit && (
            <p className="text-body-xs text-success-fg">
              Unité {selectedUnit.code} sélectionnée — {formatFcfa(selectedUnit.monthlyRent)}/mois.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loyer mensuel (FCFA)" htmlFor="newLeaseRent" required hint="Pré-rempli depuis l'unité, modifiable">
              <Input
                id="newLeaseRent"
                inputMode="numeric"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Caution (FCFA)" htmlFor="newLeaseDeposit" hint="0 si aucune">
              <Input
                id="newLeaseDeposit"
                inputMode="numeric"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Jour d'échéance du loyer" htmlFor="newLeaseDueDay" required hint="1 à 28">
              <Input
                id="newLeaseDueDay"
                inputMode="numeric"
                value={rentDueDay}
                onChange={(e) => setRentDueDay(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Date d'entrée" htmlFor="newLeaseStart" required>
              <Input id="newLeaseStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </div>

          <Button type="submit" disabled={submitting || !selectedUnit} className="self-start">
            {submitting ? "Création en cours…" : !selectedUnit ? "Sélectionnez une unité" : "Créer le bail"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LeaseCard({
  lease,
  renterId,
  accessToken,
  canManage,
  canReadDocs,
  isDg,
  onChanged,
}: {
  lease: Lease;
  renterId: number;
  accessToken: string | null;
  isDg: boolean;
  canManage: boolean;
  // Paiements/quittances : locataires OU comptabilite (plus large que
  // `canManage`, qui ne couvre que locataires).
  canReadDocs: boolean;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            {lease.unit.designationLabel} <span className="text-ink-muted">({lease.unit.code})</span>
          </CardTitle>
          {lease.arrears?.status === "late" ? (
            <Badge variant="danger" dot>
              En retard {lease.arrears.daysLate} j
            </Badge>
          ) : (
            <Badge variant="success" dot>
              À jour
            </Badge>
          )}
        </div>
        <CardDescription>
          {lease.unit.property.owner.name} · {PROPERTY_TYPE_LABELS[lease.unit.property.type]}
          {lease.unit.property.address ? ` · ${lease.unit.property.address}` : ""}
        </CardDescription>
        <Attribution actor={lease.createdBy} verb="Bail créé par" at={lease.createdAt} className="mt-0.5 block" />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Loyer mensuel" value={formatFcfa(lease.monthlyRent)} />
          <Metric
            label="Caution"
            value={formatFcfa(lease.depositAmount)}
            sub={lease.depositStatus === "held" ? "Conservée" : "Restituée"}
          />
          <Metric label="Entrée dans les lieux" value={lease.startDate} />
          <Metric
            label="Prochaine échéance"
            value={lease.arrears?.dueDate ?? "—"}
            sub={lease.arrears ? `Payé jusqu'à ${lease.arrears.paidThroughMonth ?? "aucun mois"}` : undefined}
          />
        </div>

        {(lease.unit.sonebMeterNumber || lease.unit.sbeeMeterNumber) && (
          <div className="flex flex-wrap gap-4 text-body-xs text-ink-muted">
            {lease.unit.sonebMeterNumber && <span>Compteur SONEB : {lease.unit.sonebMeterNumber}</span>}
            {lease.unit.sbeeMeterNumber && <span>Compteur SBEE : {lease.unit.sbeeMeterNumber}</span>}
            {lease.unit.furnished && <Badge variant="info">Meublé</Badge>}
          </div>
        )}

        {canManage && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-body-sm text-ink-soft">
                <DoorOpen size={16} className="text-primary" />
                {lease.moveInReport?.status === "finalized" ? (
                  <span>
                    État des lieux d&apos;entrée réalisé le {lease.moveInReport.conductedAt}
                    {lease.moveInReport.conductedBy && ` par ${lease.moveInReport.conductedBy.name} (${lease.moveInReport.conductedBy.roleLabel})`}
                  </span>
                ) : lease.moveInReport ? (
                  <span className="text-warning-fg">
                    État des lieux d&apos;entrée en brouillon depuis le {lease.moveInReport.conductedAt}
                  </span>
                ) : (
                  <span className="text-ink-muted">État des lieux d&apos;entrée non réalisé</span>
                )}
              </div>
              <Link href={`/espace/locataires/${renterId}/etat-des-lieux?leaseId=${lease.id}`}>
                <Button variant="ghost" size="sm">
                  {lease.moveInReport?.status === "finalized"
                    ? "Voir l'état des lieux"
                    : lease.moveInReport
                      ? "Continuer le brouillon"
                      : "Réaliser l'état des lieux"}
                </Button>
              </Link>
            </div>

            {/* État des lieux de sortie : ne peut être "finalized" tant que le bail est
                actif (finaliser la sortie termine le bail) — seuls "non réalisé" et
                "brouillon" sont possibles ici. Affiché en symétrie avec l'entrée
                ci-dessus, pour que les deux fiches soient visibles côte à côte ; l'action
                elle-même reste le bouton « Locataire quitte le logement » ci-dessous. */}
            <div className="flex items-center gap-2 text-body-sm text-ink-soft">
              <LogOut size={16} className="text-danger-fg" />
              {lease.moveOutReport ? (
                <span className="text-warning-fg">
                  État des lieux de sortie en brouillon depuis le {lease.moveOutReport.conductedAt}
                </span>
              ) : (
                <span className="text-ink-muted">État des lieux de sortie non réalisé</span>
              )}
            </div>
          </div>
        )}

        <ComplaintsSection leaseId={lease.id} renterId={renterId} accessToken={accessToken} />

        <ChargesSection leaseId={lease.id} renterId={renterId} accessToken={accessToken} />

        <PaymentRegister lease={lease} accessToken={accessToken} canManage={canReadDocs} isDg={isDg} onRecorded={onChanged} />
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Link href={`/espace/locataires/${renterId}/sortie?leaseId=${lease.id}`}>
            <Button variant="destructive" size="sm">
              <LogOut size={16} />
              {lease.moveOutReport ? "Continuer la sortie" : "Locataire quitte le logement"}
            </Button>
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="tabular font-currency-table text-ink">{value}</span>
      {sub && <span className="text-body-xs text-ink-muted">{sub}</span>}
    </div>
  );
}

/**
 * Plaintes rattachées à ce bail (étape 7). N'apparaît que pour qui a la
 * permission dédiée `plaintes` — distincte de `locataires`, un agent peut
 * gérer les baux sans avoir accès à ce module (et inversement).
 */
function ComplaintsSection({
  leaseId,
  renterId,
  accessToken,
}: {
  leaseId: number;
  renterId: number;
  accessToken: string | null;
}) {
  const { user } = useAuth();
  const canView = user?.role === "dg" || (user?.permissions.includes("plaintes") ?? false);
  const [complaints, setComplaints] = React.useState<Complaint[] | null>(null);

  React.useEffect(() => {
    if (!accessToken || !canView) return;
    listComplaints(accessToken, { leaseId }).then((res) => setComplaints(res.complaints));
  }, [accessToken, leaseId, canView]);

  if (!canView) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Plaintes & incidents</span>
        <Link href={`/espace/plaintes/nouveau?renterId=${renterId}`}>
          <Button variant="warning" size="sm">
            <Plus size={14} />
            Signaler un incident
          </Button>
        </Link>
      </div>

      {complaints === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : complaints.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune plainte enregistrée pour ce bail.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {complaints.map((c) => (
            <Link
              key={c.id}
              href={`/espace/plaintes/${c.id}`}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-muted"
            >
              <div className="flex items-center gap-2">
                {c.priority === "urgente" && <AlertTriangle size={14} className="text-danger-fg" />}
                <div>
                  <p className="font-label-sm text-ink">{c.code} — {c.title}</p>
                  <p className="text-body-xs text-ink-muted">Signalé le {c.reportedAt}</p>
                </div>
              </div>
              <Badge variant={c.status === "resolue" ? "success" : c.status === "en_cours" ? "info" : c.status === "fermee" ? "neutral" : "warning"}>
                {COMPLAINT_STATUS_LABELS[c.status]}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Charges SONEB/SBEE rattachées à ce bail (étape 9). Permission dédiée
 * `charges` — distincte de `locataires` ET de `comptabilite`, par défaut
 * réservée au comptable (catalogue de permissions de l'étape 3).
 */
function ChargesSection({
  leaseId,
  renterId,
  accessToken,
}: {
  leaseId: number;
  renterId: number;
  accessToken: string | null;
}) {
  const { user } = useAuth();
  const canView = user?.role === "dg" || (user?.permissions.includes("charges") ?? false);
  const [charges, setCharges] = React.useState<UtilityCharge[] | null>(null);

  React.useEffect(() => {
    if (!accessToken || !canView) return;
    listCharges(accessToken, { leaseId }).then((res) => setCharges(res.charges));
  }, [accessToken, leaseId, canView]);

  if (!canView) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Charges SONEB & SBEE</span>
        <Link href={`/espace/charges/nouveau?renterId=${renterId}`}>
          <Button variant="info" size="sm">
            <Plus size={14} />
            Nouvelle charge
          </Button>
        </Link>
      </div>

      {charges === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : charges.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune charge SONEB/SBEE enregistrée pour ce bail.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {charges.map((c) => (
            <Link
              key={c.id}
              href="/espace/charges"
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-muted"
            >
              <div>
                <p className="font-label-sm text-ink">
                  {UTILITY_TYPE_LABELS[c.utilityType]} — {c.periodStart} → {c.periodEnd}
                </p>
                <p className="text-body-xs text-ink-muted">{formatFcfa(c.amount)} · facturé le {c.billedAt}</p>
              </div>
              <Badge variant={c.status === "payee" ? "success" : c.status === "partiellement_payee" ? "info" : "warning"}>
                {CHARGE_STATUS_LABELS[c.status]}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

function PaymentRegister({
  lease,
  accessToken,
  canManage,
  isDg,
  onRecorded,
}: {
  lease: Lease;
  accessToken: string | null;
  // Enregistrer un paiement / télécharger une quittance : réservé à
  // locataires OU comptabilite côté serveur — la fiche est désormais
  // consultable par tout employé, mais pas ces actions financières.
  canManage: boolean;
  isDg: boolean;
  onRecorded: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(String(lease.monthlyRent));
  const [method, setMethod] = React.useState<PaymentMethod>("mobile_money");
  const [paidAt, setPaidAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  // Mois de départ = prochain mois dû (le serveur enchaîne les mois suivants selon le montant).
  const startMonth = lease.arrears?.nextDueMonth ?? new Date().toISOString().slice(0, 7);
  const alloc = previewRentAllocation(startMonth, lease.monthlyRent, Number(amount) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPayment(accessToken, lease.id, {
        amount: Number(amount),
        paymentMethod: method,
        paidAt,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setNotes("");
      if (result.queued) {
        toast.warning(
          "Paiement enregistré hors-ligne — sera synchronisé automatiquement dès le retour de la connexion.",
        );
      } else if (result.monthsCovered && result.monthsCovered > 1) {
        toast.success(`${result.monthsCovered} paiements enregistrés — ${result.monthsCovered} quittances générées.`);
      } else {
        toast.success("Paiement enregistré — quittance générée.");
      }
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le paiement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Registre des paiements</span>
        {canManage && (
          <Button variant="success" size="sm" onClick={() => setOpen((v) => !v)}>
            <Receipt size={14} />
            {open ? "Fermer" : "Enregistrer un paiement"}
          </Button>
        )}
      </div>

      {open && canManage && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field
            label="Montant reçu (FCFA)"
            htmlFor="amount"
            required
            hint={`Loyer mensuel : ${formatFcfa(lease.monthlyRent)}. Saisissez plusieurs mois d'un coup, ex. ${formatFcfa(lease.monthlyRent * 3)} = 3 mois.`}
          >
            <Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </Field>

          {Number(amount) > 0 && alloc.monthsCovered > 0 && (
            <div className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink-soft">
              {alloc.monthsCovered === 1 && !alloc.items[0].isPartial && (
                <>Couvre <span className="font-label-md text-ink">{monthLabelFr(alloc.items[0].coversMonth)}</span> — 1 quittance.</>
              )}
              {alloc.monthsCovered === 1 && alloc.items[0].isPartial && (
                <>
                  Paiement partiel de <span className="font-label-md text-ink">{formatFcfa(alloc.partialAmount)}</span> sur{" "}
                  {monthLabelFr(alloc.items[0].coversMonth)} — il restera {formatFcfa(lease.monthlyRent - alloc.partialAmount)}{" "}
                  dû ce mois-là. 1 quittance.
                </>
              )}
              {alloc.monthsCovered > 1 && (
                <>
                  <span className="font-label-md text-ink">{alloc.monthsCovered} mois</span> :{" "}
                  {alloc.items.map((it, i) => (
                    <span key={it.coversMonth}>
                      {i > 0 && ", "}
                      {monthLabelFr(it.coversMonth)}
                      {it.isPartial && ` (${formatFcfa(it.amount)}, avance partielle)`}
                    </span>
                  ))}
                  {" — "}
                  {alloc.monthsCovered} quittances.
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mode de règlement" htmlFor="method" required>
              <select
                id="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de paiement" htmlFor="paidAt" required>
              <Input id="paidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optionnel)" htmlFor="notes">
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Enregistrement…" : "Enregistrer le paiement"}
          </Button>
        </form>
      )}

      {lease.payments.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucun paiement enregistré pour ce bail.</p>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Période</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Enregistré par</TableHead>
              <TableHead className="text-right">Quittance</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {lease.payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.coversMonth}</TableCell>
                <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                <TableCell className="text-ink-soft">{p.paymentMethodLabel}</TableCell>
                <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                <TableCell className="text-ink-soft">
                  {p.recordedBy ? `${p.recordedBy.name} (${p.recordedBy.roleLabel})` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {p.receipt && canManage && (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => accessToken && openAuthenticatedPdf(receiptPdfPath(lease.id, p.id), accessToken)}
                        className="inline-flex items-center gap-1 font-label-sm text-primary hover:underline"
                      >
                        <FileText size={14} />
                        {p.receipt.number}
                      </button>
                      <DocumentDownloadStatus
                        documentType="quittance"
                        referenceId={p.id}
                        accessToken={accessToken}
                        isDg={isDg}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
