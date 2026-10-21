"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getMonthBilan, type MonthBilan, type MonthBilanResponse } from "@/lib/api/accounting";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateLabel, formatFcfa } from "@/lib/utils";

/**
 * Bilan détaillé d'un mois (demande de l'utilisateur, 21/10/2026) : entrées, sorties, par Bien,
 * propriétaires, locataires, dépenses, charges et contrôles de cohérence. Tout vient de
 * `GET /api/accounting/month-bilan/:month` — aucun calcul métier ici. Un mois clôturé affiche la photo
 * figée à la clôture ; un mois ouvert, le calcul en direct.
 */

const INFLOW_LABELS: Record<string, string> = {
  rent: "Loyers encaissés (argent réel)",
  openingDebt: "Dette initiale réglée",
  prorata: "Prorata d'entrée",
  entryFees: "Frais d'agence",
  lateFees: "Pénalités de retard",
  saleCommissions: "Commissions de vente",
  rentDeposits: "Cautions de loyer reçues",
  extraDeposits: "Cautions supplémentaires reçues",
  utilityCollected: "Charges SONEB/SBEE payées par les locataires",
};
const OUTFLOW_LABELS: Record<string, string> = {
  ownerPayouts: "Reversements aux propriétaires",
  chargeRemittances: "Reversements de charges SONEB/SBEE",
  propertyExpenses: "Dépenses de Biens (avancées pour le propriétaire)",
  cabinetExpenses: "Dépenses de fonctionnement du cabinet",
  fixedAssets: "Achats d'immobilisations",
  rentDepositsReturned: "Cautions de loyer restituées",
  extraDepositsReturned: "Cautions supplémentaires restituées",
};
const METHOD_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile money",
  virement: "Virement",
  cheque: "Chèque",
  kkiapay: "KkiaPay",
  caution: "Sur la caution",
};

type TabKey = "synthese" | "biens" | "proprietaires" | "locataires" | "depenses" | "controles";
const TABS: { key: TabKey; label: string }[] = [
  { key: "synthese", label: "Entrées & sorties" },
  { key: "biens", label: "Par bien" },
  { key: "proprietaires", label: "Propriétaires" },
  { key: "locataires", label: "Locataires" },
  { key: "depenses", label: "Dépenses & charges" },
  { key: "controles", label: "Contrôles" },
];

export function MonthBilanPanel({ month, accessToken }: { month: string; accessToken: string | null }) {
  const [data, setData] = React.useState<MonthBilanResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabKey>("synthese");

  React.useEffect(() => {
    if (!accessToken) return;
    setData(null);
    setError(null);
    getMonthBilan(accessToken, month)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le bilan de ce mois."));
  }, [accessToken, month]);

  if (error) {
    return (
      <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
        {error}
      </div>
    );
  }
  if (!data) return <p className="text-body-sm text-ink-muted">Chargement du bilan…</p>;

  const b = data.bilan;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-body-xs text-ink-muted">
        {data.source === "snapshot" ? (
          <Badge variant="neutral">
            <Lock size={12} className="mr-1 inline" />
            Photo figée à la clôture{data.frozenAt ? ` (${formatDateLabel(String(data.frozenAt).slice(0, 10))})` : ""}
          </Badge>
        ) : (
          <Badge variant="info">{data.isClosed ? "Clôturé — calcul en direct" : "Mois ouvert — calcul en direct"}</Badge>
        )}
        <span>
          Du {formatDateLabel(b.from)} au {formatDateLabel(b.to)} · commission comptée à{" "}
          {b.commissionTiming === "encaissement" ? "l'encaissement du loyer" : "chaque reversement"}
        </span>
      </div>

      {data.drift && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-body-sm text-warning-fg">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Les données actuelles de ce mois diffèrent de la photo figée à la clôture (régularisation ou correction
            postérieure). Les chiffres ci-dessous sont ceux de la clôture.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          title="Variation réelle de trésorerie"
          value={b.treasury.net}
          hint={`${formatFcfa(b.treasury.in)} entrés − ${formatFcfa(b.treasury.out)} sortis (argent des propriétaires inclus)`}
        />
        <KpiCard
          title="Résultat net du cabinet"
          value={b.cabinet.netIncome}
          hint="Commission + frais d'agence + pénalités + commissions de vente − dépenses de fonctionnement"
        />
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-t-md px-3 py-2 text-body-sm transition-colors",
              tab === t.key ? "border-b-2 border-primary font-label-md text-primary" : "text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.key === "controles" && !b.allControlsOk && <span className="ml-1 text-danger-fg">!</span>}
          </button>
        ))}
      </div>

      {tab === "synthese" && <SyntheseTab b={b} />}
      {tab === "biens" && <BiensTab b={b} />}
      {tab === "proprietaires" && <ProprietairesTab b={b} />}
      {tab === "locataires" && <LocatairesTab b={b} />}
      {tab === "depenses" && <DepensesTab b={b} />}
      {tab === "controles" && <ControlesTab b={b} />}
    </div>
  );
}

function KpiCard({ title, value, hint }: { title: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-4 py-3">
      <p className="text-body-xs uppercase tracking-wider text-ink-muted">{title}</p>
      <p className={cn("font-display text-headline-sm tabular", value < 0 ? "text-danger-fg" : "text-ink")}>
        {formatFcfa(value)}
      </p>
      <p className="text-body-xs text-ink-muted">{hint}</p>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn("py-2 pr-2 font-label-sm text-body-xs uppercase tracking-wider text-ink-muted", right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}
function Td({ children, right, strong }: { children?: React.ReactNode; right?: boolean; strong?: boolean }) {
  return (
    <td className={cn("py-2 pr-2", right && "text-right tabular", strong ? "font-label-md text-ink" : "text-ink-soft")}>
      {children}
    </td>
  );
}

function LinesTable({ title, lines, labels, total }: { title: string; lines: Record<string, number>; labels: Record<string, string>; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-label-sm uppercase tracking-wider text-ink-muted">{title}</p>
      <table className="w-full border-collapse text-body-sm">
        <tbody>
          {Object.entries(labels).map(([key, label]) => (
            <tr key={key} className="border-b border-border-subtle">
              <Td>{label}</Td>
              <Td right>{formatFcfa(lines[key] ?? 0)}</Td>
            </tr>
          ))}
          <tr>
            <Td strong>Total</Td>
            <Td right strong>
              {formatFcfa(total)}
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SyntheseTab({ b }: { b: MonthBilan }) {
  const r = b.inflows.rent;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LinesTable title="Entrées d'argent" lines={b.inflows.lines} labels={INFLOW_LABELS} total={b.inflows.total} />
        <LinesTable title="Sorties d'argent" lines={b.outflows.lines} labels={OUTFLOW_LABELS} total={b.outflows.total} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">
          Loyers encaissés ce mois-ci ({r.count} paiement{r.count > 1 ? "s" : ""}) — selon le mois couvert
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Loyer de ce mois", value: r.ceMois },
            { label: "Arriérés (mois passés)", value: r.arriere },
            { label: "Payé d'avance (mois futurs)", value: r.avance },
            { label: "Réglé sur la caution", value: r.fromDeposit },
          ].map((it) => (
            <div key={it.label} className="rounded-lg bg-surface-muted px-3 py-2">
              <p className="text-body-xs text-ink-muted">{it.label}</p>
              <p className="font-label-md tabular text-ink">{formatFcfa(it.value)}</p>
            </div>
          ))}
        </div>
        {r.byMethod.length > 0 && (
          <p className="text-body-xs text-ink-muted">
            Modes de paiement :{" "}
            {r.byMethod.map((m) => `${METHOD_LABELS[m.method] ?? m.method} ${formatFcfa(m.total)}`).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Résultat du cabinet</p>
        <table className="w-full border-collapse text-body-sm">
          <tbody>
            {[
              ["Commission sur loyers", b.cabinet.commission],
              ["Frais d'agence", b.cabinet.entryFees],
              ["Pénalités de retard réglées", b.cabinet.lateFees],
              ["Commissions de vente", b.cabinet.saleCommissions],
              ["− Dépenses de fonctionnement", -b.cabinet.expenses],
            ].map(([label, value]) => (
              <tr key={label as string} className="border-b border-border-subtle">
                <Td>{label}</Td>
                <Td right>{formatFcfa(value as number)}</Td>
              </tr>
            ))}
            <tr>
              <Td strong>Résultat net</Td>
              <Td right strong>
                {formatFcfa(b.cabinet.netIncome)}
              </Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BiensTab({ b }: { b: MonthBilan }) {
  if (b.properties.length === 0) return <p className="text-body-sm text-ink-muted">Aucun mouvement sur un Bien ce mois-ci.</p>;
  const sum = (k: keyof MonthBilan["properties"][number]) => b.properties.reduce((s, p) => s + (p[k] as number), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-body-sm">
        <thead>
          <tr className="border-b border-border">
            <Th>Bien</Th>
            <Th>Propriétaire</Th>
            <Th right>Loyers</Th>
            <Th right>Dette init. + prorata</Th>
            <Th right>Dépenses</Th>
            <Th right>Recette nette</Th>
            <Th right>Commission</Th>
            <Th right>Part propriétaire</Th>
          </tr>
        </thead>
        <tbody>
          {b.properties.map((p) => (
            <tr key={`${p.propertyId}-${p.ownerId}`} className="border-b border-border-subtle">
              <Td strong>{p.propertyCode}</Td>
              <Td>{p.ownerName}</Td>
              <Td right>{formatFcfa(p.rent)}</Td>
              <Td right>{formatFcfa(p.openingDebt + p.prorata)}</Td>
              <Td right>{formatFcfa(p.expenses)}</Td>
              <Td right>{formatFcfa(p.netRevenue)}</Td>
              <Td right>{formatFcfa(p.commission)}</Td>
              <Td right strong>
                {formatFcfa(p.ownerShare)}
              </Td>
            </tr>
          ))}
          <tr>
            <Td strong>Total</Td>
            <Td />
            <Td right strong>{formatFcfa(sum("rent"))}</Td>
            <Td right strong>{formatFcfa(sum("openingDebt") + sum("prorata"))}</Td>
            <Td right strong>{formatFcfa(sum("expenses"))}</Td>
            <Td right strong>{formatFcfa(sum("netRevenue"))}</Td>
            <Td right strong>{formatFcfa(sum("commission"))}</Td>
            <Td right strong>{formatFcfa(sum("ownerShare"))}</Td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-body-xs text-ink-muted">
        Chaque montant compte dans le mois où l&apos;argent est réellement entré ou sorti ; la commission est calculée
        au taux en vigueur le jour de chaque encaissement.
      </p>
    </div>
  );
}

function ProprietairesTab({ b }: { b: MonthBilan }) {
  if (b.owners.length === 0) return <p className="text-body-sm text-ink-muted">Aucun propriétaire concerné.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-body-sm">
        <thead>
          <tr className="border-b border-border">
            <Th>Propriétaire</Th>
            <Th right>Solde début</Th>
            <Th right>+ Encaissé</Th>
            <Th right>− Dépenses</Th>
            <Th right>− Commission</Th>
            <Th right>− Reversé</Th>
            <Th right>Solde fin de mois</Th>
            <Th>Statut</Th>
          </tr>
        </thead>
        <tbody>
          {b.owners.map((o) => (
            <tr key={o.ownerId} className="border-b border-border-subtle">
              <Td strong>
                <Link href={`/espace/proprietaires/${o.ownerId}`} className="text-primary hover:underline">
                  {o.ownerName}
                </Link>
              </Td>
              <Td right>{formatFcfa(o.openingBalance)}</Td>
              <Td right>{formatFcfa(o.collected)}</Td>
              <Td right>{formatFcfa(o.expenses)}</Td>
              <Td right>{formatFcfa(o.commission)}</Td>
              <Td right>{formatFcfa(o.payouts)}</Td>
              <Td right strong>{formatFcfa(o.closingBalance)}</Td>
              <Td>
                <Badge variant={o.status === "reverse" ? "success" : "warning"} dot>
                  {o.status === "reverse" ? "Reversé" : "Reste à reverser"}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LocatairesTab({ b }: { b: MonthBilan }) {
  const t = b.tenants;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-ink-soft">
        État des impayés au {formatDateLabel(t.asOf)} : <strong>{formatFcfa(t.totalOwed)}</strong> dus par {t.count}{" "}
        locataire{t.count > 1 ? "s" : ""}.
      </p>
      {t.list.length === 0 ? (
        <p className="flex items-center gap-2 text-body-sm text-success-fg">
          <CheckCircle2 size={16} /> Aucun impayé à cette date.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>Locataire</Th>
                <Th>Bien</Th>
                <Th right>Mois impayés</Th>
                <Th right>Jours de retard</Th>
                <Th right>Dette initiale</Th>
                <Th right>Pénalités</Th>
                <Th right>Total dû</Th>
              </tr>
            </thead>
            <tbody>
              {t.list.map((r) => (
                <tr key={r.leaseId} className="border-b border-border-subtle">
                  <Td strong>{r.renterName}</Td>
                  <Td>
                    {r.propertyCode} / {r.unitCode}
                  </Td>
                  <Td right>{r.unpaidMonths}</Td>
                  <Td right>{r.daysLate}</Td>
                  <Td right>{formatFcfa(r.openingDebtRemaining)}</Td>
                  <Td right>{formatFcfa(r.lateFeesRemaining)}</Td>
                  <Td right strong>{formatFcfa(r.amountOwed)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DepensesTab({ b }: { b: MonthBilan }) {
  const e = b.expenses;
  const c = b.charges;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Fonctionnement du cabinet", value: e.cabinetTotal },
          { label: "Dépenses de Biens", value: e.propertyTotal },
          { label: "Engagées, pas encore payées", value: e.engagedUnpaid.total },
          { label: "Charges impayées fin de mois", value: c.unpaidAtEndOfMonth.total },
        ].map((it) => (
          <div key={it.label} className="rounded-lg bg-surface-muted px-3 py-2">
            <p className="text-body-xs text-ink-muted">{it.label}</p>
            <p className="font-label-md tabular text-ink">{formatFcfa(it.value)}</p>
          </div>
        ))}
      </div>

      {e.lines.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune dépense payée ce mois-ci.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>Date de paiement</Th>
                <Th>Libellé</Th>
                <Th>Catégorie</Th>
                <Th>Imputée à</Th>
                <Th right>Montant</Th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id} className="border-b border-border-subtle">
                  <Td>{formatDateLabel(l.paidAt)}</Td>
                  <Td strong>{l.label}</Td>
                  <Td>{l.category}</Td>
                  <Td>{l.propertyCode ? `Bien ${l.propertyCode} (propriétaire)` : "Cabinet"}</Td>
                  <Td right>{formatFcfa(l.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-body-xs text-ink-muted">
        Une dépense non encore payée est comptée dans le mois où elle sera payée, jamais avant.
      </p>

      <div className="flex flex-col gap-2">
        <p className="font-label-sm uppercase tracking-wider text-ink-muted">Charges SONEB / SBEE</p>
        <table className="w-full border-collapse text-body-sm">
          <tbody>
            {[
              { label: "Factures émises ce mois", v: c.billed },
              { label: "Encaissées auprès des locataires", v: c.collected },
              { label: "Reversées aux propriétaires", v: c.remitted },
              { label: "Impayées à la fin du mois", v: c.unpaidAtEndOfMonth },
            ].map(({ label, v }) => (
              <tr key={label} className="border-b border-border-subtle">
                <Td>{label}</Td>
                <Td right>{v.count} opération(s)</Td>
                <Td right>{formatFcfa(v.total)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ControlesTab({ b }: { b: MonthBilan }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-ink-soft">
        Chaque chiffre est recalculé par un second chemin ; un écart signale une incohérence à examiner.
      </p>
      {b.controls.map((c) => (
        <div
          key={c.key}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-body-sm",
            c.ok ? "border-success-border bg-success-bg text-success-fg" : "border-danger-border bg-danger-bg text-danger-fg",
          )}
        >
          {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <div>
            <p>{c.label}</p>
            {!c.ok && (
              <p className="text-body-xs">
                Attendu {formatFcfa(c.expected)} · obtenu {formatFcfa(c.actual)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
