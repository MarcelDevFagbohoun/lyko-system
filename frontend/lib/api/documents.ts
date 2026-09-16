import { apiFetch } from "./client";

/**
 * Suivi des téléchargements de quittance/attestation/relevé propriétaire
 * (étape 29) — consultation/réinitialisation côté espace employé, et
 * vérification publique par code (sans compte).
 */
export type DocumentType = "quittance" | "attestation" | "releve_proprietaire";

export type DocumentIssuanceStatus = {
  downloadCount: number;
  maxDownloads: number;
  lastDownloadedAt: string | null;
};

export function getDocumentStatus(accessToken: string, documentType: DocumentType, referenceId: number) {
  return apiFetch<DocumentIssuanceStatus>(`/api/documents/${documentType}/${referenceId}/status`, { accessToken });
}

/** Réservé au DG (appliqué aussi côté serveur). */
export function resetDocumentDownloads(accessToken: string, documentType: DocumentType, referenceId: number) {
  return apiFetch<DocumentIssuanceStatus>(`/api/documents/${documentType}/${referenceId}/reset`, {
    method: "POST",
    accessToken,
  });
}

export type DocumentVerificationResult =
  | { valid: true; documentType: DocumentType; documentTypeLabel: string; companyName: string; issuedAt: string }
  | { valid: false };

/** Page publique /verifier — aucun compte requis, jamais de token envoyé. */
export function verifyDocumentCode(code: string) {
  return apiFetch<DocumentVerificationResult>(`/api/verify/${encodeURIComponent(code)}`);
}
