"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ExitExtraLine, ExitExtraLineKind } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const EXTRA_KIND_LABELS: Record<ExitExtraLineKind, string> = {
  main_oeuvre: "Main-d'œuvre",
  penalite: "Pénalité",
  autre: "Autre retenue",
  realisee_locataire: "Réparation faite par le locataire",
};

const selectCls =
  "h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Saisie des lignes libres du point de sortie : main-d'œuvre, pénalités, réparations faites par le locataire. */
export function ExitLinesEditor({ lines, onChange }: { lines: ExitExtraLine[]; onChange: (lines: ExitExtraLine[]) => void }) {
  const set = (i: number, patch: Partial<ExitExtraLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">Main-d&apos;œuvre, pénalités et autres retenues</span>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[190px_1fr_130px_40px]">
          <select aria-label="Nature" className={selectCls} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as ExitExtraLineKind, amount: e.target.value === "realisee_locataire" ? 0 : l.amount })}>
            {Object.entries(EXTRA_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <Input aria-label="Libellé" placeholder="Ex. repeindre le salon" value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Input
            aria-label="Montant"
            inputMode="numeric"
            placeholder="Montant"
            disabled={l.kind === "realisee_locataire"}
            value={l.kind === "realisee_locataire" ? "0" : l.amount ? String(l.amount) : ""}
            onChange={(e) => set(i, { amount: Number(e.target.value.replace(/\D/g, "")) || 0 })}
          />
          <Button type="button" variant="ghost" size="sm" aria-label="Retirer la ligne" onClick={() => onChange(lines.filter((_, k) => k !== i))}>
            <Trash2 size={15} />
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => onChange([...lines, { kind: "main_oeuvre", label: "", amount: 0 }])}>
        <Plus size={15} /> Ajouter une ligne
      </Button>
    </div>
  );
}

export type ExitStatementData = {
  depositAmount: number;
  itemsDeductions: number;
  extraLines: ExitExtraLine[];
  rentOwed: number;
  rentMonths: string[];
  peintureOverflow: number;
  refundMethodLabel?: string | null;
};

/** Tableau du point de sortie (en-tête bleu, lignes blanches) : de la caution versée au solde final. */
export function ExitStatementTable({ data }: { data: ExitStatementData }) {
  const billable = data.extraLines.filter((l) => l.kind !== "realisee_locataire" && l.amount > 0);
  const done = data.extraLines.filter((l) => l.kind === "realisee_locataire");
  const gross = data.itemsDeductions + billable.reduce((s, l) => s + l.amount, 0) + data.rentOwed + data.peintureOverflow;
  const solde = data.depositAmount - gross;
  const rows: { label: string; detail: string; amount: string; tone: "ok" | "bad" | "muted" }[] = [
    { label: "Caution de loyer versée", detail: "Montant détenu", amount: formatFcfa(data.depositAmount), tone: "ok" },
  ];
  if (data.itemsDeductions > 0) rows.push({ label: "Dégradations constatées", detail: "Détail pièce par pièce ci-dessus", amount: `- ${formatFcfa(data.itemsDeductions)}`, tone: "bad" });
  for (const l of billable) rows.push({ label: EXTRA_KIND_LABELS[l.kind], detail: l.label, amount: `- ${formatFcfa(l.amount)}`, tone: "bad" });
  if (data.rentOwed > 0) {
    rows.push({
      label: "Loyers impayés",
      detail: data.rentMonths.length > 0 ? data.rentMonths.join(", ") : "Déduits automatiquement de la caution",
      amount: `- ${formatFcfa(data.rentOwed)}`,
      tone: "bad",
    });
  }
  if (data.peintureOverflow > 0) rows.push({ label: "Dépassement caution peinture", detail: "Reporté sur la caution de loyer", amount: `- ${formatFcfa(data.peintureOverflow)}`, tone: "bad" });
  for (const l of done) rows.push({ label: "Réparation faite par le locataire", detail: l.label, amount: "0", tone: "muted" });

  const tone = { ok: "text-success-fg", bad: "text-danger-fg", muted: "text-ink-muted" } as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="bg-primary text-white">
            <th className="px-3 py-2 text-left font-label-md">Désignation</th>
            <th className="px-3 py-2 text-left font-label-md">Détail</th>
            <th className="px-3 py-2 text-right font-label-md">Montant (FCFA)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-strong bg-surface">
              <td className="border-x border-border-strong px-3 py-2 text-ink">{r.label}</td>
              <td className="border-r border-border-strong px-3 py-2 text-ink-soft">{r.detail}</td>
              <td className={`tabular border-r border-border-strong px-3 py-2 text-right font-label-md ${tone[r.tone]}`}>{r.amount}</td>
            </tr>
          ))}
          <tr className="border-b border-border-strong bg-surface">
            <td className="border-x border-border-strong px-3 py-2 font-label-md text-ink" colSpan={2}>Total des retenues</td>
            <td className="tabular border-r border-border-strong px-3 py-2 text-right font-label-md text-danger-fg">- {formatFcfa(gross)}</td>
          </tr>
          <tr className={solde >= 0 ? "bg-success-bg" : "bg-danger-bg"}>
            <td className="border-x border-border-strong px-3 py-2.5 font-label-md text-ink" colSpan={2}>
              {solde >= 0 ? "Solde à restituer au locataire" : "Reste dû par le locataire"}
              {data.refundMethodLabel && solde >= 0 ? ` — ${data.refundMethodLabel}` : ""}
            </td>
            <td className={`tabular border-r border-border-strong px-3 py-2.5 text-right font-label-md text-body-md ${solde >= 0 ? "text-success-fg" : "text-danger-fg"}`}>
              {formatFcfa(Math.abs(solde))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const METHODS = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

export type BalanceChoice = { resolution: "" | "paid" | "repairs_by_tenant"; paymentMethod: string; note: string };

/** Solde négatif : le locataire règle la différence, ou effectue les réparations. */
export function BalanceDueSection({ shortfall, value, onChange }: { shortfall: number; value: BalanceChoice; onChange: (v: BalanceChoice) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg p-4">
      <p className="font-label-md text-danger-fg">Le locataire doit encore {formatFcfa(shortfall)} : ses dettes dépassent la caution.</p>
      <p className="text-body-sm text-ink-soft">Il doit compléter la somme ou effectuer lui-même les réparations avant de finaliser la sortie.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {([
          ["paid", "Il règle la différence"],
          ["repairs_by_tenant", "Il effectue les réparations"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-body-sm text-ink">
            <input type="radio" name="balanceResolution" checked={value.resolution === k} onChange={() => onChange({ ...value, resolution: k })} />
            {label}
          </label>
        ))}
      </div>
      {value.resolution === "paid" && (
        <select aria-label="Mode de règlement" className={`${selectCls} max-w-xs`} value={value.paymentMethod} onChange={(e) => onChange({ ...value, paymentMethod: e.target.value })}>
          <option value="" disabled>Mode de règlement…</option>
          {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      )}
      {value.resolution && (
        <Input aria-label="Précision" placeholder="Précision (optionnel)" value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      )}
    </div>
  );
}
