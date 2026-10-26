"use client";

import * as React from "react";
import { History } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { listDeletedEntries, type DeletedEntry } from "@/lib/api/accounting";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";


export function DeletedEntriesSection({ accessToken }: { accessToken: string | null }) {
  const [entries, setEntries] = React.useState<DeletedEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listDeletedEntries(accessToken)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal des suppressions."));
  }, [accessToken]);

  if (entries !== null && entries.length === 0) return null;

  return (
    <Card className="border-danger-border/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <History size={16} className="text-danger-fg" />
          <CardTitle>Journal des suppressions</CardTitle>
        </div>
        <CardDescription>
          Dépenses et charges SONEB/SBEE supprimées par la comptabilité ou les agents, visibles du DG uniquement,
          exclues des totaux, avec justification obligatoire.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        {entries === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Élément</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Créé par</TableHead>
                <TableHead>Supprimé par</TableHead>
                <TableHead>Le</TableHead>
                <TableHead>Justification</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={`${e.type}-${e.id}`}>
                  <TableCell>
                    <Badge variant="neutral">{e.type === "expense" ? "Dépense" : "Charge"}</Badge>{" "}
                    <span className="text-ink">{e.label}</span>
                    <div className="text-body-xs text-ink-muted">{e.date}</div>
                  </TableCell>
                  <TableAmount>{formatFcfa(e.amount)}</TableAmount>
                  <TableCell className="text-ink-soft">
                    {e.createdBy ? `${e.createdBy.name} (${e.createdBy.roleLabel})` : "—"}
                  </TableCell>
                  <TableCell className="text-ink-soft">
                    {e.deletedBy ? `${e.deletedBy.name} (${e.deletedBy.roleLabel})` : "—"}
                  </TableCell>
                  <TableCell className="text-ink-soft">{e.deletedAt.slice(0, 10)}</TableCell>
                  <TableCell className="text-ink-soft">{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// Chaque carte reprend la teinte de son statut réel (vert = favorable, rouge
// = défavorable, orange = à surveiller) — la couleur porte l'information,
// jamais seule (icône + libellé toujours présents), tokens Badge/charte.
