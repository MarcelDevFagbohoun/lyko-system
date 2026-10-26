"use client";



import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getRenter, type Lease, type MoveOutReport } from "@/lib/api/renters";
import { RequireAuth } from "@/components/auth/require-auth";
import { Card, CardContent } from "@/components/ui/card";
import { DraftEditor } from "./sections/draft-editor";
import { FinalizedView } from "./sections/finalized-view";
import { StartCard } from "./sections/start-card";

export function SortieView() {
  return (
    <RequireAuth permission="etats_des_lieux">
      <SortieContent />
    </RequireAuth>
  );
}

function SortieContent() {
  const { id } = useParams<{ id: string }>();
  const renterId = Number(id);
  const searchParams = useSearchParams();
  const leaseId = Number(searchParams.get("leaseId"));
  const router = useRouter();
  const { accessToken } = useAuth();

  const [lease, setLease] = React.useState<Lease | null>(null);
  const [renterName, setRenterName] = React.useState("");
  const [report, setReport] = React.useState<MoveOutReport | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken || !Number.isInteger(renterId) || !Number.isInteger(leaseId)) return;
    getRenter(accessToken, renterId)
      .then((res) => {
        setRenterName(`${res.renter.firstName} ${res.renter.lastName}`);
        const found = res.leases.find((l) => l.id === leaseId);
        if (!found) throw new ApiError(404, "Bail introuvable");
        setLease(found);
        setReport(found.moveOutReport);
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

  if (!lease) {
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

        {report?.status === "finalized" ? (
          <FinalizedView leaseId={leaseId} lease={lease} report={report} accessToken={accessToken} onReportChange={setReport} />
        ) : report ? (
          <DraftEditor
            leaseId={leaseId}
            lease={lease}
            report={report}
            accessToken={accessToken}
            onReportChange={setReport}
            onFinalized={() => router.push(`/espace/locataires/${renterId}`)}
            renterName={renterName}
          />
        ) : lease.status !== "active" ? (
          <Card className="max-w-2xl">
            <CardContent className="py-6 text-body-sm text-ink-muted">
              Ce bail est déjà terminé sans état des lieux de sortie enregistré (départ traité avant la mise en
              place de ce module). Aucun décompte de caution ne peut être généré rétroactivement.
            </CardContent>
          </Card>
        ) : (
          <StartCard leaseId={leaseId} accessToken={accessToken} onStarted={setReport} />
        )}
      </div>
    </div>
  );
}

