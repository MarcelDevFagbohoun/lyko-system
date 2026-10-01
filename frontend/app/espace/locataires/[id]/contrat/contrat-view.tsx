"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, FileDown } from "lucide-react";
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
import { FinalizeSection } from "@/components/inspections/finalize-section";
import { SignatureBlock } from "@/components/inspections/signature-block";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatFcfa } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";

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
  const { accessToken, user } = useAuth();
  const canManage = user?.role === "dg" || (user?.permissions.includes("locataires") ?? false);

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
          <FinalizedView lease={lease} contract={contract} preview={preview} accessToken={accessToken} />
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

/** Rendu à l'écran des mêmes articles que le PDF (`services/pdf.js` `streamLeaseContractPdf`) — texte
 * uniquement, pour relecture avant signature ; le PDF reste la seule version imprimable/signée. */
function ContractArticles({ data }: { data: LeaseContractData }) {
  const depositLines: string[] = [];
  if (data.lease.depositAmount > 0) depositLines.push(`une caution de loyer de ${formatFcfa(data.lease.depositAmount)}`);
  for (const d of data.additionalDeposits) depositLines.push(`une caution ${d.typeLabel} de ${formatFcfa(d.amount)}`);

  const articles: { title: string; body: string }[] = [
    {
      title: "Les parties",
      body:
        `Entre les soussignés : d'une part, ${data.owner.name}${data.owner.address ? `, domicilié à ${data.owner.address}` : ""}, ` +
        `propriétaire du bien désigné à l'article 2, représenté aux fins des présentes par le cabinet, ci-après dénommé « le Bailleur » ; ` +
        `et d'autre part, ${data.renter.firstName} ${data.renter.lastName}, joignable au ${data.renter.phone}, ci-après dénommé « le Locataire ».`,
    },
    {
      title: "Objet du contrat",
      body:
        `Le Bailleur donne à bail au Locataire le bien désigné « ${data.unit.designationLabel} » (${data.unit.code}) au sein de ` +
        `l'immeuble ${data.property.code} (${data.property.typeLabel})${data.property.address ? `, sis ${data.property.address}` : ""}, ` +
        `livré ${data.unit.furnished ? "meublé" : "non meublé"}.`,
    },
    {
      title: "Durée et prise d'effet",
      body: `Le présent bail prend effet le ${data.lease.startDate}, pour une durée indéterminée.`,
    },
    {
      title: "Loyer et modalités de paiement",
      body:
        `Le loyer mensuel est fixé à ${formatFcfa(data.lease.monthlyRent)}, payable ${data.lease.rentTimingLabel.toLowerCase()}, ` +
        `au plus tard le ${data.lease.rentDueDay} de chaque mois.` +
        (data.lease.entryFeeAmount > 0 ? ` Des frais d'agence de ${formatFcfa(data.lease.entryFeeAmount)} restent acquis au cabinet.` : ""),
    },
    {
      title: "Caution(s)",
      body:
        depositLines.length > 0
          ? `Le Locataire verse, à la signature, ${depositLines.join(", ")}. Chaque caution est restituable en fin de bail, déduction faite des dégradations et/ou impayés constatés à la sortie.`
          : "Aucune caution n'est exigée à la signature du présent bail.",
    },
    {
      title: "Obligations du Locataire",
      body: "Payer le loyer et les charges aux échéances convenues, occuper les lieux paisiblement, les entretenir et les rendre en fin de bail dans l'état constaté à l'entrée, sauf vétusté normale.",
    },
    {
      title: "Obligations du Bailleur",
      body: "Délivrer un logement décent, assurer la jouissance paisible des lieux et restituer la ou les cautions dans les conditions de l'article 5.",
    },
    {
      title: "Résiliation",
      body: "Chaque partie peut résilier le bail moyennant un préavis raisonnable notifié par écrit ; un état des lieux contradictoire est établi à la sortie.",
    },
  ];
  if (data.particularConditions && data.particularConditions.trim()) {
    articles.push({ title: "Conditions particulières", body: data.particularConditions });
  }

  return (
    <div className="flex flex-col gap-4">
      {articles.map((a, i) => (
        <div key={a.title}>
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

  async function handleFinalize(tenantSignature: Blob, agentSignature: Blob) {
    if (!accessToken) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await persist();
      const res = await finalizeContract(accessToken, leaseId, tenantSignature, agentSignature);
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

            <FinalizeSection onFinalize={handleFinalize} submitting={finalizing} error={finalizeError} />
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
  accessToken,
}: {
  lease: Lease;
  contract: LeaseContract;
  preview: LeaseContractData;
  accessToken: string | null;
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SignatureBlock label="Signature du locataire" url={contract.tenantSignatureUrl} accessToken={accessToken} />
          <SignatureBlock label="Signature de l'agent" url={contract.agentSignatureUrl} accessToken={accessToken} />
        </div>
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
