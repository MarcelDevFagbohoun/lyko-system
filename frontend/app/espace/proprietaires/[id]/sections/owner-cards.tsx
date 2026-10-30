"use client";

import * as React from "react";
import {
  Link2,
  Copy,
  Check,
  MessageCircle,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { updateOwner, generateOwnerPortalLink, type Owner } from "@/lib/api/owners";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Portail propriétaire (étape 13, idée n°1) : génère/régénère le lien secret
 * (sans mot de passe) donnant accès à sa recette du mois, son patrimoine et
 * l'historique de ses versements. Même révélation unique que le portail
 * locataire (`locataire-view.tsx`) et les identifiants d'un employé.
 */
export function PortalLinkCard({
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
    <Card tone="cyan" accent>
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
export function EditOwnerForm({
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
