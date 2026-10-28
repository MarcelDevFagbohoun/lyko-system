"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { CalendarClock, Flag, MessageSquare, Repeat } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getComplaintTracking, sendTrackingComment, type TrackingView } from "@/lib/api/complaint-tracking";
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUS_BADGE_VARIANT } from "@/lib/constants/complaints";
import { cn, formatDateLabel, formatDateTimeLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_HINT = {
  non_resolue: "Votre signalement est en cours de traitement.",
  resolue: "Votre signalement a été traité. Écrivez-nous si le problème persiste.",
} as const;
const MAX = 1000;

/**
 * Page publique de suivi d'une réclamation : le jeton du lien est le seul secret. N'affiche que ce que
 * le serveur a marqué visible du locataire — l'équipe y apparaît sous un seul nom, jamais un employé.
 */
export function SuiviView() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = React.useState<TrackingView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    getComplaintTracking(token)
      .then(setView)
      .catch((err) => setLoadError(err instanceof ApiError && err.status === 404 ? "Ce lien est invalide ou n'est plus valable." : "Ce suivi est momentanément inaccessible. Réessayez dans un instant."));
  }, [token]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return setError("Écrivez votre message.");
    setSending(true);
    setError(null);
    try {
      setView(await sendTrackingComment(token, text));
      setMessage("");
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer votre message pour le moment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas">
      <header className="flex w-full items-center justify-center border-b border-border bg-surface px-4 py-4">
        <span className="font-display text-headline-md text-ink">{view?.company.name ?? "Suivi de réclamation"}</span>
      </header>
      <main className="flex w-full flex-1 flex-col items-center px-4 py-8 sm:py-10">
        <div className="flex w-full max-w-2xl flex-col gap-5">
          {loadError ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-3 text-body-sm text-danger-fg">{loadError}</div>
          ) : !view ? (
            <p className="text-body-sm text-ink-muted">Chargement…</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-headline-lg text-ink">{view.complaint.code}</h1>
                  <Badge variant={COMPLAINT_STATUS_BADGE_VARIANT[view.complaint.status]}>{COMPLAINT_STATUS_LABELS[view.complaint.status]}</Badge>
                </div>
                <p className="break-words text-body-lg text-ink">{view.complaint.title}</p>
                <p className="text-body-sm text-ink-soft">{STATUS_HINT[view.complaint.status]}</p>
                {(view.complaint.property || view.complaint.unit) && (
                  <p className="text-body-xs text-ink-muted">
                    {view.complaint.property}
                    {view.complaint.unit ? ` · ${view.complaint.unit}` : ""}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
                {[
                  { label: "Signalée le", value: formatDateTimeLabel(view.dates.reportedAt) },
                  { label: "Dernière mise à jour", value: formatDateTimeLabel(view.dates.lastActivityAt) },
                  { label: "Résolue le", value: view.dates.resolvedAt ? formatDateLabel(view.dates.resolvedAt) : "—" },
                ].map((it) => (
                  <div key={it.label} className="flex min-w-0 flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1.5 font-label-sm uppercase tracking-wider text-ink-muted">
                      <CalendarClock size={13} aria-hidden />{it.label}
                    </span>
                    <span className="text-body-sm text-ink">{it.value}</span>
                  </div>
                ))}
              </div>

              {view.complaint.description && (
                <div className="rounded-lg border border-border bg-surface-muted p-3">
                  <p className="font-label-sm text-ink-muted">Votre description</p>
                  <p className="whitespace-pre-wrap break-words text-body-sm text-ink">{view.complaint.description}</p>
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Évolution du dossier</CardTitle>
                  <CardDescription>Chaque étape est datée.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="flex flex-col">
                    {view.events.map((e, i) => {
                      const Icon = e.type === "reported" ? Flag : e.type === "status_changed" ? Repeat : MessageSquare;
                      const who = e.by === "tenant" ? "Vous" : view.teamLabel;
                      const title =
                        e.type === "reported"
                          ? "Signalement envoyé"
                          : e.type === "status_changed"
                            ? `Statut : ${e.toStatus ? COMPLAINT_STATUS_LABELS[e.toStatus] : ""}`
                            : who;
                      return (
                        <li key={e.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-ink-soft">
                              <Icon size={14} aria-hidden />
                            </span>
                            {i < view.events.length - 1 && <span className="my-1 w-px flex-1 bg-border" aria-hidden />}
                          </div>
                          <div className={cn("min-w-0 flex-1", i < view.events.length - 1 ? "pb-5" : "")}>
                            <p className="font-label-md text-ink">{title}</p>
                            <p className="text-body-xs text-ink-muted">
                              {formatDateTimeLabel(e.createdAt)}
                              {e.isEstimated && " (date approximative)"}
                            </p>
                            {e.body && (
                              <p className={cn("mt-1.5 whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-body-sm text-ink", e.by === "tenant" ? "bg-surface-muted" : "border border-border bg-surface")}>
                                {e.body}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Répondre ou ajouter une précision</CardTitle>
                  <CardDescription>Votre message est transmis à l&apos;équipe de gestion.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSend} className="flex flex-col gap-3">
                    {error && <p className="text-body-sm text-danger-fg" role="alert">{error}</p>}
                    {sent && !error && <p className="text-body-sm text-success-fg" role="status">Message envoyé. Merci !</p>}
                    <label htmlFor="trackingMessage" className="sr-only">Votre message</label>
                    <textarea
                      id="trackingMessage"
                      rows={4}
                      value={message}
                      maxLength={MAX}
                      onChange={(e) => { setMessage(e.target.value); setSent(false); }}
                      placeholder="Ex. : je suis disponible demain matin pour l'intervention."
                      className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-body-xs text-ink-muted">{message.length}/{MAX}</span>
                      <Button type="submit" disabled={sending || !message.trim()}>{sending ? "Envoi…" : "Envoyer"}</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
