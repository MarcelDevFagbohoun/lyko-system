"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, FileDown, Lock, Stamp } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, openAuthenticatedPdf } from "@/lib/api/client";
import {
  getRenter,
  getContract,
  startContract,
  updateContract,
  finalizeContract,
  contractPdfPath,
  type Lease,
  type LeaseContract,
  type LeaseContractData,
} from "@/lib/api/renters";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/toast/toast-context";
import { useCan } from "@/lib/auth/use-can";

export function ContratView() {
  return (
    <RequireAuth permission={["locataires", "comptabilite"]}>
      <ContratContent />
    </RequireAuth>
  );
}

function ContratContent() {
  const { id } = useParams<{ id: string }>();
  const renterId = Number(id);
  const searchParams = useSearchParams();
  const leaseId = Number(searchParams.get("leaseId"));
  const router = useRouter();
  const { accessToken } = useAuth();
  const canManage = useCan("locataires");

  const [lease, setLease] = React.useState<Lease | null>(null);
  const [renterName, setRenterName] = React.useState("");
  const [contract, setContract] = React.useState<LeaseContract | null>(null);
  const [preview, setPreview] = React.useState<LeaseContractData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(renterId) || !Number.isInteger(leaseId)) return;
    Promise.all([getRenter(accessToken, renterId), getContract(accessToken, leaseId)])
      .then(([renterRes, contractRes]) => {
        setRenterName(`${renterRes.renter.firstName} ${renterRes.renter.lastName}`);
        const found = renterRes.leases.find((l) => l.id === leaseId);
        if (!found) throw new ApiError(404, "Bail introuvable");
        setLease(found);
        setContract(contractRes.contract);
        setPreview(contractRes.preview);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger le bail."));
  }, [accessToken, renterId, leaseId]);

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

  if (!lease || !preview) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href={`/espace/locataires/${renterId}`}
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour à la fiche de {renterName}
        </Link>

        {!contract ? (
          <StartCard leaseId={leaseId} accessToken={accessToken} canManage={canManage} onStarted={(c, p) => { setContract(c); setPreview(p); }} />
        ) : contract.status === "finalized" ? (
          <FinalizedView lease={lease} contract={contract} preview={preview} />
        ) : (
          <DraftEditor
            leaseId={leaseId}
            lease={lease}
            preview={preview}
            accessToken={accessToken}
            canManage={canManage}
            onChange={(c, p) => { setContract(c); setPreview(p); }}
            onFinalized={() => router.push(`/espace/locataires/${renterId}`)}
          />
        )}
      </div>
    </div>
  );
}

function StartCard({
  leaseId,
  accessToken,
  canManage,
  onStarted,
}: {
  leaseId: number;
  accessToken: string | null;
  canManage: boolean;
  onStarted: (contract: LeaseContract, preview: LeaseContractData) => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleStart() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startContract(accessToken, leaseId);
      onStarted(res.contract, res.preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer le contrat.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <FileText size={28} className="text-ink-muted" />
        <p className="font-label-md text-ink">Aucun contrat pour ce bail</p>
        <p className="text-body-sm text-ink-muted">
          Les articles (parties, objet, durée, loyer, caution…) sont calculés automatiquement depuis les
          données du bail — seules les conditions particulières restent à rédiger.
        </p>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {canManage ? (
          <Button onClick={handleStart} disabled={submitting}>
            {submitting ? "Préparation…" : "Préparer le contrat"}
          </Button>
        ) : (
          <p className="text-body-xs text-ink-faint">Seul un agent gérant les locataires peut préparer ce contrat.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Découpe `renderedText` en articles `{ title, body }`, même convention `## Titre` que le backend
 * (`services/leaseContractTemplate.js` `parseContractBlocks`) — c'est le backend qui a déjà rendu le
 * texte (modèle de l'entreprise, personnalisable en Paramètres, ou modèle par défaut) ; ce composant
 * ne fait que l'afficher, jamais de calcul de données ici.
 */
function parseContractBlocks(renderedText: string): { title: string; body: string }[] {
  const lines = (renderedText || "").replace(/\r\n/g, "\n").split("\n");
  const articles: { title: string; bodyLines: string[] }[] = [];
  let current: { title: string; bodyLines: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line.trim());
    if (m) {
      current = { title: m[1].trim(), bodyLines: [] };
      articles.push(current);
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  return articles
    .map((a) => ({ title: a.title, body: a.bodyLines.join("\n").trim().replace(/\n{3,}/g, "\n\n") }))
    .filter((a) => a.title && a.body);
}

/** Rendu à l'écran des mêmes articles que le PDF (`services/pdf.js` `streamLeaseContractPdf`) — texte
 * uniquement, pour relecture avant signature ; le PDF reste la seule version imprimable/signée. */
function ContractArticles({ data }: { data: LeaseContractData }) {
  const articles = parseContractBlocks(data.renderedText);
  if (data.particularConditions && data.particularConditions.trim()) {
    articles.push({ title: "Conditions particulières", body: data.particularConditions });
  }

  return (
    <div className="flex flex-col gap-4">
      {articles.map((a, i) => (
        <div key={`${i}-${a.title}`}>
          <p className="font-label-sm text-primary">Article {i + 1} — {a.title}</p>
          <p className="whitespace-pre-wrap text-body-sm text-ink-soft">{a.body}</p>
        </div>
      ))}
    </div>
  );
}

function DraftEditor({
  leaseId,
  lease,
  preview,
  accessToken,
  canManage,
  onChange,
  onFinalized,
}: {
  leaseId: number;
  lease: Lease;
  preview: LeaseContractData;
  accessToken: string | null;
  canManage: boolean;
  onChange: (contract: LeaseContract, preview: LeaseContractData) => void;
  onFinalized: () => void;
}) {
  const [particularConditions, setParticularConditions] = React.useState(preview.particularConditions ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalizeError, setFinalizeError] = React.useState<string | null>(null);
  const toast = useToast();

  async function persist() {
    if (!accessToken) throw new Error("no token");
    const res = await updateContract(accessToken, leaseId, particularConditions.trim());
    onChange(res.contract, res.preview);
    return res;
  }

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      await persist();
      toast.success("Brouillon enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le brouillon.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!accessToken) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await persist();
      const res = await finalizeContract(accessToken, leaseId);
      onChange(res.contract, res.preview);
      toast.success("Contrat de bail finalisé et verrouillé.");
      onFinalized();
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : "Impossible de finaliser le contrat.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Contrat de bail — brouillon</CardTitle>
            <CardDescription>
              {lease.unit.designationLabel} ({lease.unit.code}) · relisez les articles, ajoutez d&apos;éventuelles
              conditions particulières, puis finalisez avec les signatures.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => accessToken && openAuthenticatedPdf(contractPdfPath(leaseId), accessToken)}
          >
            <FileDown size={16} />
            Aperçu PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        <div className="rounded-lg border border-border bg-surface-muted p-4">
          <ContractArticles data={{ ...preview, particularConditions }} />
        </div>

        {canManage && (
          <>
            <div className="flex flex-col gap-2">
              <label className="font-label-sm text-ink-soft">Conditions particulières (optionnel)</label>
              <textarea
                value={particularConditions}
                onChange={(e) => setParticularConditions(e.target.value)}
                rows={4}
                placeholder="Ex. autorisation d'un animal domestique, aménagement particulier convenu entre les parties…"
                className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleSave} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
              </Button>
            </div>

            {/* Plus de signatures à capturer (demande utilisateur, 2026-11-02) : le contrat finalisé
                porte OBLIGATOIREMENT le cachet du DG — le serveur refuse s'il n'a pas été téléversé
                (Mon compte). */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
              <div>
                <h3 className="flex items-center gap-1.5 font-label-lg text-ink">
                  <Stamp size={16} className="text-ink-soft" />
                  Finaliser le contrat
                </h3>
                <p className="text-body-sm text-ink-muted">
                  Une fois finalisé, le contrat est verrouillé et porte le cachet de l&apos;entreprise — il ne peut plus être modifié.
                </p>
              </div>
              {finalizeError && <p className="text-body-sm text-danger-fg">{finalizeError}</p>}
              <Button type="button" size="lg" onClick={handleFinalize} disabled={finalizing} className="self-start">
                <Lock size={16} />
                {finalizing ? "Finalisation…" : "Finaliser et verrouiller"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FinalizedView({
  lease,
  contract,
  preview,
}: {
  lease: Lease;
  contract: LeaseContract;
  preview: LeaseContractData;
}) {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Contrat de bail</CardTitle>
            <CardDescription>
              {lease.unit.designationLabel} ({lease.unit.code})
              {contract.finalizedAt && ` · signé le ${new Date(contract.finalizedAt).toLocaleDateString("fr-FR")}`}
              {contract.finalizedBy && ` par ${contract.finalizedBy.name} (${contract.finalizedBy.roleLabel})`}
            </CardDescription>
          </div>
          <Badge variant="success">Signé</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <DownloadContractButton leaseId={lease.id} />

        <div className="rounded-lg border border-border bg-surface-muted p-4">
          <ContractArticles data={preview} />
        </div>

        <p className="flex items-center gap-1.5 text-body-sm text-ink-muted">
          <Stamp size={14} />
          Contrat signé du cachet de l&apos;entreprise — voir le PDF téléchargeable ci-dessus.
        </p>
      </CardContent>
    </Card>
  );
}

function DownloadContractButton({ leaseId }: { leaseId: number }) {
  const { accessToken } = useAuth();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="self-start"
      onClick={() => accessToken && openAuthenticatedPdf(contractPdfPath(leaseId), accessToken)}
    >
      <FileDown size={16} />
      Télécharger le contrat signé
    </Button>
  );
}
