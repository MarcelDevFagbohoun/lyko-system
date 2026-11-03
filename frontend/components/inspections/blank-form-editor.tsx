"use client";

import * as React from "react";
import { X, FileDown } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getInspectionMasterZones, downloadInspectionBlankFormPdf, type InspectionZone } from "@/lib/api/renters";
import { InspectionForm } from "./inspection-form";
import { Button } from "@/components/ui/button";

/**
 * Formulaire d'état des lieux vierge, personnalisable avant téléchargement (demande utilisateur,
 * 2026-11-03 : « il doit pouvoir éditer le formulaire, ajouter d'autres choses s'il veut avant de le
 * télécharger »). Part de la grille standard (`GET /master-zones`), librement adaptée à l'écran — même
 * éditeur que la saisie en ligne, sans retenues ni photos (rien n'est persisté nulle part, ni bail ni
 * brouillon) — puis générée en PDF côté serveur avec CETTE liste, jamais celle, figée, du serveur.
 */
export function BlankFormEditorButton({
  kind,
  accessToken,
  label,
}: {
  kind: "entree" | "sortie";
  accessToken: string | null;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <FileDown size={14} />
        {label}
      </Button>
      {open && <BlankFormEditorModal kind={kind} accessToken={accessToken} onClose={() => setOpen(false)} />}
    </>
  );
}

function BlankFormEditorModal({
  kind,
  accessToken,
  onClose,
}: {
  kind: "entree" | "sortie";
  accessToken: string | null;
  onClose: () => void;
}) {
  const [zones, setZones] = React.useState<InspectionZone[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getInspectionMasterZones(accessToken)
      .then((res) => setZones(res.zones))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger la grille standard."));
  }, [accessToken]);

  // Échap ferme — jamais ne télécharge (même principe que `ConfirmDialog`) ; aucun effet pendant
  // l'envoi, pour ne pas fermer la modale sous la requête.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !downloading) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [downloading, onClose]);

  async function handleDownload() {
    if (!accessToken || !zones) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadInspectionBlankFormPdf(accessToken, kind, zones);
      onClose();
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Impossible de générer le PDF.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blank-form-editor-title"
      onClick={() => !downloading && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="blank-form-editor-title" className="font-display text-headline-sm text-ink">
              Formulaire vierge — {kind === "sortie" ? "état des lieux de sortie" : "état des lieux d'entrée"}
            </h2>
            <p className="text-body-sm text-ink-soft">
              Ajoutez, renommez ou retirez des pièces et des éléments avant de télécharger — rien
              n&apos;est enregistré ici, seule la liste choisie part dans le PDF.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={downloading} aria-label="Fermer">
            <X size={16} />
          </Button>
        </div>

        {loadError && <p className="text-body-sm text-danger-fg">{loadError}</p>}
        {downloadError && <p className="text-body-sm text-danger-fg">{downloadError}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {zones ? (
            <InspectionForm
              zones={zones}
              onChange={setZones}
              showDeductions={false}
              onUploadPhoto={() => {}}
              onDeletePhoto={() => {}}
              accessToken={accessToken}
            />
          ) : !loadError ? (
            <p className="text-body-sm text-ink-muted">Chargement…</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={downloading}>
            Annuler
          </Button>
          <Button type="button" onClick={handleDownload} disabled={!zones || downloading}>
            <FileDown size={16} />
            {downloading ? "Génération…" : "Télécharger le PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
