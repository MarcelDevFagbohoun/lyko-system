"use client";

import * as React from "react";
import {
  Link2,
  Copy,
  Check,
  MessageCircle,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { updateRenter, generatePortalLink, type Renter } from "@/lib/api/renters";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { useToast } from "@/lib/toast/toast-context";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";


/**
 * Portail locataire (étape 12, idée n°2) : génère/régénère le lien secret
 * (sans mot de passe) donnant accès au tableau de bord du locataire — ses
 * paiements/quittances, son solde, son contrat de bail, et le signalement d'un
 * incident. Même logique de révélation unique que les identifiants d'un
 * employé (`app/espace/employes/nouveau`) : le token n'est affiché qu'une
 * fois ici, jamais ré-affichable ensuite (seul son empreinte est stockée).
 */
export function PortalLinkCard({
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
    <Card tone="cyan" accent>
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

/** Formulaire de modification de l'identité du locataire (nom, email, profession). */
export function EditRenterForm({
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
    <Card tone="slate" accent>
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
