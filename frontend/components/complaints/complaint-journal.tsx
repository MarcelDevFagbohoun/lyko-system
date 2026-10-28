"use client";

import * as React from "react";
import { CalendarClock, CheckCircle2, Copy, Eye, Flag, Lock, MessageCircle, MessageSquare, Repeat } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  addComplaintEvent,
  getComplaintTrackingLink,
  type Complaint,
  type ComplaintDates,
  type ComplaintEvent,
} from "@/lib/api/complaints";
import { COMPLAINT_STATUS_LABELS } from "@/lib/constants/complaints";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { cn, formatDateLabel, formatDateTimeLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { useToast } from "@/lib/toast/toast-context";

const MAX_COMMENT = 2000;

/** Bandeau des dates clés : signalement, dernière mise à jour, résolution. */
export function ComplaintDatesBanner({ dates }: { dates: ComplaintDates }) {
  const items = [
    { label: "Signalée le", value: formatDateTimeLabel(dates.reportedAt) },
    { label: "Dernière mise à jour", value: formatDateTimeLabel(dates.lastActivityAt) },
    { label: "Résolue le", value: dates.resolvedAt ? formatDateLabel(dates.resolvedAt) : "—" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 font-label-sm uppercase tracking-wider text-ink-muted">
            <CalendarClock size={13} aria-hidden />
            {it.label}
          </span>
          <span className="text-body-sm text-ink">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function EventIcon({ type }: { type: ComplaintEvent["type"] }) {
  const Icon = type === "reported" ? Flag : type === "status_changed" ? Repeat : MessageSquare;
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-ink-soft">
      <Icon size={14} aria-hidden />
    </span>
  );
}

function eventTitle(e: ComplaintEvent): string {
  if (e.type === "reported") return "Plainte signalée";
  if (e.type === "status_changed") {
    const from = e.fromStatus ? COMPLAINT_STATUS_LABELS[e.fromStatus] : null;
    const to = e.toStatus ? COMPLAINT_STATUS_LABELS[e.toStatus] : "";
    // Historique d'avant la simplification à deux statuts (étape 2026-10-28) :
    // un ancien changement ouverte→en_cours retombe désormais sur le même
    // statut des deux côtés — on l'affiche comme une simple mise à jour.
    if (from && from === to) return "Dossier mis à jour";
    return from ? `Statut : ${from} → ${to}` : `Statut : ${to}`;
  }
  return e.author?.role === "locataire" ? "Message du locataire" : "Commentaire";
}

/** Historique daté du dossier, du plus ancien au plus récent. */
export function ComplaintTimeline({ events }: { events: ComplaintEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => (
        <li key={e.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <EventIcon type={e.type} />
            {i < events.length - 1 && <span className="my-1 w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className={cn("min-w-0 flex-1", i < events.length - 1 ? "pb-5" : "pb-0")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-label-md text-ink">{eventTitle(e)}</span>
              {e.type === "comment" &&
                (e.visibility === "internal" ? (
                  <Badge variant="neutral"><Lock size={11} className="mr-1" aria-hidden />Interne</Badge>
                ) : (
                  <Badge variant="info"><Eye size={11} className="mr-1" aria-hidden />Visible par le locataire</Badge>
                ))}
            </div>
            <p className="text-body-xs text-ink-muted">
              {formatDateTimeLabel(e.createdAt)}
              {e.isEstimated && " (date approximative)"}
              {e.author && ` · ${e.author.name}${e.author.role === "locataire" ? "" : ` (${e.author.roleLabel})`}`}
            </p>
            {e.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-body-sm text-ink">{e.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Update = { complaint: Complaint; events: ComplaintEvent[]; dates: ComplaintDates };

/** Carte « Suivi » : historique + saisie d'un commentaire + prévenir le locataire (lien WhatsApp). */
export function ComplaintJournalCard({
  complaint,
  events,
  accessToken,
  onUpdated,
}: {
  complaint: Complaint;
  events: ComplaintEvent[];
  accessToken: string | null;
  onUpdated: (u: Update) => void;
}) {
  const toast = useToast();
  const [comment, setComment] = React.useState("");
  const [visibility, setVisibility] = React.useState<"internal" | "tenant">("internal");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [trackingUrl, setTrackingUrl] = React.useState<string | null>(null);

  // Le lien est préparé à l'ouverture de la fiche : le bouton WhatsApp est un vrai lien (jamais bloqué comme fenêtre surgissante).
  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getComplaintTrackingLink(accessToken, complaint.id)
      .then((r) => { if (!cancelled) setTrackingUrl(`${window.location.origin}${r.path}`); })
      .catch(() => { if (!cancelled) setTrackingUrl(null); });
    return () => { cancelled = true; };
  }, [accessToken, complaint.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    const text = comment.trim();
    if (!text) return setError("Écrivez un commentaire.");
    if (text.length > MAX_COMMENT) return setError(`Trop long (${MAX_COMMENT} caractères max.).`);
    setSubmitting(true);
    setError(null);
    try {
      const res = await addComplaintEvent(accessToken, complaint.id, { comment: text, visibility });
      onUpdated(res);
      setComment("");
      toast.success(visibility === "tenant" ? "Commentaire ajouté, visible par le locataire." : "Commentaire interne ajouté.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce commentaire.");
    } finally {
      setSubmitting(false);
    }
  }

  const whatsappHref =
    trackingUrl && complaint.renter.phone
      ? buildWhatsAppHref(
          complaint.renter.phone,
          `Bonjour ${complaint.renter.firstName}, voici le suivi de votre signalement ${complaint.code} (${complaint.title}) : ${trackingUrl}`,
        )
      : null;

  async function copyLink() {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      toast.success("Lien de suivi copié.");
    } catch {
      toast.error("Copie impossible : sélectionnez le lien à la main.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique et commentaires</CardTitle>
        <CardDescription>
          Chaque étape est datée. Un commentaire est interne par défaut : le locataire ne voit que ce que vous choisissez de lui montrer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ComplaintTimeline events={events} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          {error && <p className="text-body-sm text-danger-fg">{error}</p>}
          <Field label="Ajouter un commentaire" htmlFor="complaintComment" hint={`${comment.length}/${MAX_COMMENT}`}>
            <textarea
              id="complaintComment"
              rows={3}
              value={comment}
              maxLength={MAX_COMMENT}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Explication, intervention prévue, échange avec le locataire…"
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Visibilité" htmlFor="complaintVisibility">
              <select
                id="complaintVisibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "internal" | "tenant")}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-72"
              >
                <option value="internal">Interne (équipe seulement)</option>
                <option value="tenant">Visible par le locataire</option>
              </select>
            </Field>
            <Button type="submit" disabled={submitting || !comment.trim()} className="w-full sm:w-auto">
              {submitting ? "Enregistrement…" : "Ajouter"}
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <p className="inline-flex items-center gap-1.5 font-label-md text-ink">
            <CheckCircle2 size={15} className="text-ink-muted" aria-hidden />
            Prévenir le locataire
          </p>
          <p className="text-body-xs text-ink-muted">
            Envoie le lien de sa page de suivi (statut et messages marqués « visibles »). Il peut y répondre.
          </p>
          <div className="flex flex-wrap gap-2">
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <Button type="button" size="sm" variant="success"><MessageCircle size={16} />Envoyer par WhatsApp</Button>
              </a>
            ) : (
              <Button type="button" size="sm" variant="success" disabled><MessageCircle size={16} />Envoyer par WhatsApp</Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={copyLink} disabled={!trackingUrl}>
              <Copy size={16} />Copier le lien
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
