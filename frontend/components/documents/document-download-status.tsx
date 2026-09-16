"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { getDocumentStatus, resetDocumentDownloads, type DocumentType } from "@/lib/api/documents";
import { Badge } from "@/components/ui/badge";

/**
 * Compteur de téléchargements d'un document remis via un portail (quittance,
 * attestation, relevé propriétaire — étape 29), affiché sur la fiche
 * employé correspondante (locataire/propriétaire). N'affiche rien tant
 * qu'aucun téléchargement n'a eu lieu — un indicateur secondaire, jamais un
 * bloc qui alourdit la page pour rien. Le bouton de réinitialisation
 * n'apparaît que pour le DG (même règle que côté serveur).
 */
export function DocumentDownloadStatus({
  documentType,
  referenceId,
  accessToken,
  isDg,
}: {
  documentType: DocumentType;
  referenceId: number;
  accessToken: string | null;
  isDg: boolean;
}) {
  const [status, setStatus] = React.useState<{ downloadCount: number; maxDownloads: number } | null>(null);
  const [resetting, setResetting] = React.useState(false);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getDocumentStatus(accessToken, documentType, referenceId)
      .then(setStatus)
      .catch(() => {
        // Silencieux : indicateur secondaire, ne doit jamais bloquer le reste de la page.
      });
  }, [accessToken, documentType, referenceId]);

  React.useEffect(() => load(), [load]);

  async function handleReset() {
    if (!accessToken || resetting) return;
    setResetting(true);
    try {
      setStatus(await resetDocumentDownloads(accessToken, documentType, referenceId));
    } catch {
      // Silencieux : le compteur reste affiché tel quel, le DG peut réessayer.
    } finally {
      setResetting(false);
    }
  }

  if (!status || status.downloadCount === 0) return null;
  const atLimit = status.downloadCount >= status.maxDownloads;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={atLimit ? "danger" : "neutral"}>
        {status.downloadCount}/{status.maxDownloads} téléchargement{status.downloadCount > 1 ? "s" : ""}
      </Badge>
      {isDg && (
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          title="Réinitialiser le compteur de téléchargements"
          aria-label="Réinitialiser le compteur de téléchargements"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-50"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </span>
  );
}
