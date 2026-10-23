"use client";

import * as React from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getCardDetail, type CardDetail, type CardKey } from "@/lib/api/accounting";
import { INFLOW_LABELS, OUTFLOW_LABELS } from "@/app/espace/cloture/month-bilan-panel";
import { cn, formatDateLabel, formatFcfa, monthLabelFr } from "@/lib/utils";

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function range(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
}

/**
 * Détail d'une carte de la comptabilité : formule de calcul, puis chaque opération datée du mois.
 * Navigation mois par mois ; le contrôle « somme des lignes = chiffre de la carte » est affiché.
 */
export function CardDetailDialog({
  card,
  initialMonth,
  accessToken,
  onClose,
}: {
  card: CardKey | null;
  initialMonth: string;
  accessToken: string | null;
  onClose: () => void;
}) {
  const [month, setMonth] = React.useState(initialMonth);
  const [detail, setDetail] = React.useState<CardDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (card) setMonth(initialMonth);
  }, [card, initialMonth]);

  React.useEffect(() => {
    if (!card || !accessToken) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    const { from, to } = range(month);
    getCardDetail(accessToken, card, from, to)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Détail indisponible."));
    return () => {
      cancelled = true;
    };
  }, [card, month, accessToken]);

  React.useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;
  const labels: Record<string, string> = { ...INFLOW_LABELS, ...OUTFLOW_LABELS };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 animate-fade-in" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={detail?.title ?? "Détail"}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-5xl animate-slide-in-left flex-col overflow-hidden bg-canvas shadow-xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div>
            <h2 className="font-display text-headline-md text-ink">{detail?.title ?? "Chargement…"}</h2>
            <p className="text-body-sm text-ink-muted">
              {detail?.undated ? `Situation au ${detail.asOf ? formatDateLabel(detail.asOf) : "jour"}` : <span className="capitalize">{monthLabelFr(month)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Mois précédent" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded border border-border-strong bg-surface p-2 hover:bg-surface-muted">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[8.5rem] text-center font-label-md capitalize text-ink">{monthLabelFr(month)}</span>
            <button type="button" aria-label="Mois suivant" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded border border-border-strong bg-surface p-2 hover:bg-surface-muted">
              <ChevronRight size={16} />
            </button>
            <button type="button" aria-label="Fermer" onClick={onClose} className="ml-2 rounded p-2 text-ink-muted hover:bg-surface-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && <p className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</p>}
          {!detail && !error && <p className="text-body-sm text-ink-muted">Chargement…</p>}
          {detail && (
            <div className="flex flex-col gap-6">
              {/* Calcul */}
              <section className="flex flex-col gap-2">
                <h3 className="font-label-sm uppercase tracking-wider text-ink-muted">Comment ce chiffre est calculé</h3>
                <div className="overflow-hidden rounded-lg border border-border-strong bg-surface">
                  {detail.formula.map((f, i) => (
                    <div key={i} className={cn("flex items-start justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0", f.op === "total" && "bg-primary-bg font-label-md", f.op === "info" && "pl-8 text-body-sm text-ink-soft")}>
                      <span>
                        {f.op === "plus" && <span className="mr-2 text-success-fg">+</span>}
                        {f.op === "minus" && <span className="mr-2 text-danger-fg">−</span>}
                        {f.op === "total" && <span className="mr-2">=</span>}
                        {f.label}
                        {f.note && <span className="block text-body-xs text-ink-muted">{f.note}</span>}
                      </span>
                      <span className="tabular whitespace-nowrap font-currency-table">{formatFcfa(f.amount)}</span>
                    </div>
                  ))}
                </div>
                {detail.treasuryLines && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([["Entrées", detail.treasuryLines.inflows], ["Sorties", detail.treasuryLines.outflows]] as const).map(([t, lines]) => (
                      <div key={t} className="overflow-hidden rounded-lg border border-border-strong bg-surface">
                        <div className="bg-primary px-3 py-2 font-label-md text-white">{t}</div>
                        {lines.length === 0 && <p className="px-3 py-2 text-body-sm text-ink-muted">Aucun mouvement.</p>}
                        {lines.map((l) => (
                          <div key={l.key} className="flex justify-between gap-3 border-t border-border px-3 py-2 text-body-sm">
                            <span>{labels[l.key] ?? l.key}</span>
                            <span className="tabular font-currency-table">{formatFcfa(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-body-sm", detail.matches ? "border-success-border bg-success-bg text-success-fg" : "border-danger-border bg-danger-bg text-danger-fg")}>
                  {detail.matches ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
                  {detail.matches
                    ? `Contrôle : la somme des ${detail.count} ligne(s) (${formatFcfa(detail.rowsTotal)}) égale le chiffre de la carte.`
                    : `Écart : les lignes totalisent ${formatFcfa(detail.rowsTotal)} pour un chiffre de ${formatFcfa(detail.total)}.`}
                </div>
              </section>

              {/* Opérations */}
              {detail.columns.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-label-sm uppercase tracking-wider text-ink-muted">
                    {detail.undated ? "Détail" : "Opérations datées"} ({detail.count})
                  </h3>
                  {detail.rows.length === 0 ? (
                    <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-body-sm text-ink-muted">Aucune opération sur cette période.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border-strong bg-surface">
                      <table className="w-full border-collapse text-body-sm">
                        <thead>
                          <tr className="bg-primary text-white">
                            {detail.columns.map((c) => (
                              <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-label-md", c.type === "money" ? "text-right" : "text-left")}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="stagger">
                          {detail.rows.map((r, i) => (
                            <tr key={i} className="border-t border-border-strong transition-colors hover:bg-primary-bg">
                              {detail.columns.map((c) => (
                                <td key={c.key} className={cn("px-3 py-2", c.type === "money" ? "tabular whitespace-nowrap text-right font-currency-table" : "text-ink-soft", c.key === "who" && "text-ink")}>
                                  {c.type === "money" ? formatFcfa(Number(r[c.key])) : c.type === "date" ? (r[c.key] ? formatDateLabel(String(r[c.key])) : "—") : String(r[c.key] ?? "—")}
                                </td>
                              ))}
                            </tr>
                          ))}
                          <tr className="border-t-2 border-border-strong bg-surface-muted font-label-md">
                            <td className="px-3 py-2" colSpan={detail.columns.length - 1}>Total</td>
                            <td className="tabular px-3 py-2 text-right font-currency-table">{formatFcfa(detail.rowsTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {detail.notes.length > 0 && (
                <ul className="list-disc pl-5 text-body-xs text-ink-muted">
                  {detail.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
