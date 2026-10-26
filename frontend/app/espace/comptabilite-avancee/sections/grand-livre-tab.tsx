"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { getGeneralLedger, type GlAccount, type GeneralLedgerMovement } from "@/lib/api/gl";
import { formatFcfa, formatDateLabel } from "@/lib/utils";
import { Field } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { SELECT_CLASS } from "./shared";

export function GrandLivreTab({ accessToken, accounts }: { accessToken: string | null; accounts: GlAccount[] }) {
  const [accountId, setAccountId] = React.useState<number | null>(null);
  const [movements, setMovements] = React.useState<GeneralLedgerMovement[] | null>(null);
  const [finalBalance, setFinalBalance] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken || !accountId) return;
    getGeneralLedger(accessToken, accountId)
      .then((res) => {
        setMovements(res.movements);
        setFinalBalance(res.finalBalance);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le grand livre."));
  }, [accessToken, accountId]);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Compte" htmlFor="glAccount">
        <select
          id="glAccount"
          value={accountId ?? ""}
          onChange={(e) => setAccountId(Number(e.target.value) || null)}
          className={`${SELECT_CLASS} max-w-md`}
        >
          <option value="">Choisir un compte…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.label}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-body-sm text-danger-fg">{error}</p>}

      {accountId && movements && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>N°</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Tiers</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDateLabel(m.entryDate)}</TableCell>
                  <TableCell className="tabular">{m.entryNumber}</TableCell>
                  <TableCell>{m.narration}</TableCell>
                  <TableCell>{m.thirdPartyName ?? ""}</TableCell>
                  <TableAmount>{m.debit != null ? formatFcfa(m.debit) : ""}</TableAmount>
                  <TableAmount>{m.credit != null ? formatFcfa(m.credit) : ""}</TableAmount>
                  <TableAmount>{formatFcfa(m.runningBalance)}</TableAmount>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="self-end font-label-md text-ink">Solde final : {formatFcfa(finalBalance)}</p>
        </>
      )}
    </div>
  );
}

// ── Balance ─────────────────────────────────────────────────────────────

