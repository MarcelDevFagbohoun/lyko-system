"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Phone, Building2, Pencil, CheckCircle2, PlayCircle, Archive, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { API_URL, ApiError } from "@/lib/api/client";
import { getComplaint, updateComplaint, updateComplaintStatus, type Complaint, type ComplaintCategory, type ComplaintPriority } from "@/lib/api/complaints";
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_PRIORITY_LABELS, COMPLAINT_STATUS_LABELS } from "@/lib/constants/complaints";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Attribution } from "@/components/ui/attribution";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const STATUS_BADGE = {
  ouverte: "warning" as const,
  en_cours: "info" as const,
  resolue: "success" as const,
  fermee: "neutral" as const,
};

export function PlainteView() {
  return (
    <RequireAuth permission="plaintes">
      <PlainteContent />
    </RequireAuth>
  );
}

function PlainteContent() {
  const { id } = useParams<{ id: string }>();
  const complaintId = Number(id);
  const { accessToken } = useAuth();

  const [complaint, setComplaint] = React.useState<Complaint | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(complaintId)) return;
    getComplaint(accessToken, complaintId)
      .then((res) => setComplaint(res.complaint))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Plainte introuvable."));
  }, [accessToken, complaintId]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <EspaceHeader />
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!complaint) {
    return (
      <div className="min-h-screen bg-canvas">
        <EspaceHeader />
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace/plaintes" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour aux plaintes
        </Link>

        {editing ? (
          <EditComplaintForm
            complaint={complaint}
            accessToken={accessToken}
            onSaved={(c) => { setComplaint(c); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-headline-xl text-ink">{complaint.code}</h1>
                  <Badge variant={STATUS_BADGE[complaint.status]}>{COMPLAINT_STATUS_LABELS[complaint.status]}</Badge>
                  <Badge variant={complaint.priority === "urgente" ? "danger" : "neutral"} dot={complaint.priority === "urgente"}>
                    {COMPLAINT_PRIORITY_LABELS[complaint.priority]}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Modifier la plainte"
                    className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <p className="text-body-lg text-ink">{complaint.title}</p>
                <Attribution actor={complaint.createdBy} verb="Déclarée par" className="mt-1 block" />
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Contexte</CardTitle>
                <CardDescription>{COMPLAINT_CATEGORY_LABELS[complaint.category]} · signalé le {complaint.reportedAt}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <InfoRow
                    icon={<Phone size={14} className="text-ink-muted" />}
                    label="Locataire"
                    value={
                      <Link href={`/espace/locataires/${complaint.renter.id}`} className="text-primary hover:underline">
                        {complaint.renter.firstName} {complaint.renter.lastName} ({complaint.renter.phone})
                      </Link>
                    }
                  />
                  <InfoRow
                    icon={<Building2 size={14} className="text-ink-muted" />}
                    label="Bien / unité"
                    value={`${complaint.property.code} · ${complaint.unit.code} (${complaint.unit.designationLabel})`}
                  />
                </div>

                {complaint.description && (
                  <div className="rounded-lg border border-border bg-surface-muted p-3">
                    <p className="font-label-sm text-ink-muted">Description</p>
                    <p className="text-body-sm text-ink">{complaint.description}</p>
                  </div>
                )}

                {complaint.photoUrls.length > 0 && (
                  <div>
                    <p className="mb-2 font-label-sm uppercase tracking-wider text-ink-muted">Photos</p>
                    <div className="flex flex-wrap gap-3">
                      {complaint.photoUrls.map((url) => (
                        <a key={url} href={`${API_URL}${url}`} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`${API_URL}${url}`} alt="Photo du dossier" className="h-24 w-24 rounded-lg border border-border object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {complaint.resolutionNote && (
                  <div className="rounded-lg border border-success-border bg-success-bg p-3">
                    <p className="font-label-sm text-success-fg">Résolution {complaint.resolvedAt ? `(${complaint.resolvedAt})` : ""}</p>
                    <p className="text-body-sm text-ink">{complaint.resolutionNote}</p>
                    <Attribution actor={complaint.resolvedBy} verb="Résolue par" className="mt-1 block" />
                  </div>
                )}
              </CardContent>
            </Card>

            <StatusActions complaint={complaint} accessToken={accessToken} onChanged={load} />
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-body-sm text-ink">{icon}{value}</span>
    </div>
  );
}

function StatusActions({
  complaint,
  accessToken,
  onChanged,
}: {
  complaint: Complaint;
  accessToken: string | null;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = React.useState(false);
  const [resolutionNote, setResolutionNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function setStatus(status: Complaint["status"], note?: string) {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateComplaintStatus(accessToken, complaint.id, { status, resolutionNote: note });
      setResolving(false);
      setResolutionNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier le statut.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suivi du dossier</CardTitle>
        <CardDescription>Faites avancer le dossier au fil de la prise en charge.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {resolving ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
            <Field label="Note de résolution" htmlFor="resolutionNote" required hint="Travaux réalisés, intervenant, coût le cas échéant">
              <Input id="resolutionNote" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={submitting || !resolutionNote.trim()} onClick={() => setStatus("resolue", resolutionNote.trim())}>
                {submitting ? "Enregistrement…" : "Confirmer la résolution"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setResolving(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {complaint.status === "ouverte" && (
              <Button size="sm" onClick={() => setStatus("en_cours")} disabled={submitting}>
                <PlayCircle size={16} />
                Prendre en charge
              </Button>
            )}
            {(complaint.status === "ouverte" || complaint.status === "en_cours") && (
              <Button size="sm" variant="success" onClick={() => setResolving(true)} disabled={submitting}>
                <CheckCircle2 size={16} />
                Marquer comme résolue
              </Button>
            )}
            {complaint.status === "resolue" && (
              <Button size="sm" onClick={() => setStatus("fermee")} disabled={submitting}>
                <Archive size={16} />
                Clôturer le dossier
              </Button>
            )}
            {(complaint.status === "resolue" || complaint.status === "fermee") && (
              <Button size="sm" variant="ghost" onClick={() => setStatus("en_cours")} disabled={submitting}>
                <RotateCcw size={16} />
                Rouvrir le dossier
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditComplaintForm({
  complaint,
  accessToken,
  onSaved,
  onCancel,
}: {
  complaint: Complaint;
  accessToken: string | null;
  onSaved: (c: Complaint) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = React.useState<ComplaintCategory>(complaint.category);
  const [title, setTitle] = React.useState(complaint.title);
  const [description, setDescription] = React.useState(complaint.description ?? "");
  const [priority, setPriority] = React.useState<ComplaintPriority>(complaint.priority);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (title.trim().length < 3) return setError("Titre requis (3 caractères min.).");
    setSubmitting(true);
    setError(null);
    try {
      const res = await updateComplaint(accessToken, complaint.id, {
        category,
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      onSaved(res.complaint);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ces modifications.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Modifier la plainte {complaint.code}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Catégorie" htmlFor="editCategory" required>
              <select
                id="editCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {(Object.entries(COMPLAINT_CATEGORY_LABELS) as [ComplaintCategory, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Priorité" htmlFor="editPriority" required>
              <select
                id="editPriority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="normale">Normale</option>
                <option value="urgente">Urgente</option>
              </select>
            </Field>
          </div>
          <Field label="Titre" htmlFor="editTitle" required>
            <Input id="editTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description (optionnel)" htmlFor="editDescription">
            <Input id="editDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
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
