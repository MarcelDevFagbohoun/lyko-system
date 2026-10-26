"use client";

import * as React from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  listGlPostingRules,
  updateGlPostingRule,
  resyncGlPostingRules,
  renameGlSystemAccount,
  getIrfBalance,
  payIrf,
  type GlAccount,
  type GlPostingRule,
} from "@/lib/api/gl";
import type { PaymentMethod } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { RENAMEABLE_SYSTEM_ACCOUNTS } from "@/lib/constants/glRenameableAccounts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlOptionsCard } from "@/components/comptabilite/gl-options-card";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { PAYMENT_METHODS, SELECT_CLASS } from "./shared";

export function ReglesTab({
  accessToken,
  accounts,
  onAccountsChanged,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  onAccountsChanged: () => void;
}) {
  const [rules, setRules] = React.useState<GlPostingRule[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resyncing, setResyncing] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listGlPostingRules(accessToken)
      .then((res) => setRules(res.rules))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les règles comptables."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function toggleValidated(rule: GlPostingRule) {
    if (!accessToken) return;
    await updateGlPostingRule(accessToken, rule.id, { isValidatedByAccountant: !rule.isValidatedByAccountant });
    toast.success(
      rule.isValidatedByAccountant ? "Règle marquée comme non validée." : "Règle marquée comme validée par un comptable.",
    );
    load();
  }

  async function handleResync() {
    if (!accessToken) return;
    setResyncing(true);
    try {
      const res = await resyncGlPostingRules(accessToken);
      if (res.added.length === 0 && res.updatedSystemKeys.length === 0) {
        toast.info("Tout est déjà à jour (règles et comptes).");
      } else {
        const parts: string[] = [];
        if (res.added.length > 0) parts.push(`${res.added.length} règle(s) ajoutée(s) : ${res.added.join(", ")}`);
        if (res.updatedSystemKeys.length > 0) parts.push(`${res.updatedSystemKeys.length} compte(s) rattaché(s)`);
        toast.success(`${parts.join(" — ")}.`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Resynchronisation impossible.");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Ouvert au DG ET au comptable autorisé (`comptabilite_avancee`, déjà la
          condition d'accès à cet onglet) — décision explicite de l'utilisateur,
          contrairement à l'activation du module (ActivationCard, DG uniquement). */}
      {/* Ordre voulu : d'abord les choix courants (profil et options), puis le réglage avancé replié. */}
      <GlOptionsCard accessToken={accessToken} />

      <AdvancedGroup title="Numéros de comptes personnalisables" summary="2 comptes dont le numéro varie selon les cabinets">
        <RenameableAccountsCard accessToken={accessToken} accounts={accounts} onChanged={onAccountsChanged} />
      </AdvancedGroup>

      <AdvancedGroup
        title="Règles d'écritures par opération"
        summary={rules ? `${rules.length} règle(s) · ${rules.filter((r) => r.isValidatedByAccountant).length} validée(s) par un comptable` : "Chargement…"}
      >
      <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-body-sm text-ink-soft">
          Chaque type d&apos;opération (loyer encaissé, dépense, salaire...) est associé à des comptes débit/crédit
          paramétrables. Les règles pré-chargées à la mise en place doivent être revues et validées par votre
          expert-comptable avant une utilisation en production.
        </p>
        <Button variant="secondary" size="sm" onClick={handleResync} disabled={resyncing} className="shrink-0">
          <RefreshCw size={14} />
          {resyncing ? "Resynchronisation…" : "Resynchroniser les règles"}
        </Button>
      </div>
      <p className="text-body-xs text-ink-muted">
        Ajoute les règles des opérations récemment introduites dans Africa Immo Management et rattache les comptes qui en
        avaient besoin, sans jamais toucher une règle ou un compte déjà en place (validé ou non) — à utiliser si une
        opération signale l&apos;absence de règle ou de compte comptable.
      </p>
      {error && <p className="text-body-sm text-danger-fg">{error}</p>}
      {!rules ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <details key={rule.id} className="rounded-lg border border-border bg-surface p-3">
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-label-md text-ink">{rule.label}</span>
                  <Badge variant="neutral">{rule.journal.code}</Badge>
                  {!rule.isActive && <Badge variant="danger">Inactive</Badge>}
                </div>
                <Badge variant={rule.isValidatedByAccountant ? "success" : "warning"}>
                  {rule.isValidatedByAccountant ? "Validée par un comptable" : "À valider"}
                </Badge>
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-body-xs text-ink-muted">Libellé généré : « {rule.narrationTemplate} »</p>
                <table className="w-full text-body-sm">
                  <tbody>
                    {rule.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border first:border-0">
                        <td className="py-1.5 pr-3">
                          {l.accountCode ? `${l.accountCode} — ${l.accountLabel}` : `Résolu dynamiquement (${l.accountRole})`}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{l.side === "debit" ? "Débit" : "Crédit"}</td>
                        <td className="py-1.5 text-ink-muted">
                          {l.amountFormula === "montant_total" && "Montant total"}
                          {l.amountFormula === "pourcentage_variable" && `% (${l.formulaParam})`}
                          {l.amountFormula === "montant_moins_pourcentage" && `Montant − % (${l.formulaParam})`}
                          {l.amountFormula === "montant_fixe" && `Montant fixe : ${formatFcfa(l.fixedAmount ?? 0)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button variant="ghost" size="sm" className="self-start" onClick={() => toggleValidated(rule)}>
                  {rule.isValidatedByAccountant ? "Marquer comme non validée" : "Marquer comme validée par un comptable"}
                </Button>
              </div>
            </details>
          ))}
        </div>
      )}
      </div>
      </AdvancedGroup>
    </div>
  );
}

/** Bloc de réglages avancés, replié par défaut : le titre et un résumé suffisent tant qu'on n'y touche pas. */
export function AdvancedGroup({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group/adv rounded-xl border border-border bg-surface shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 transition-colors hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-label-md text-ink">{title}</span>
          <span className="block text-body-xs text-ink-muted">{summary} · réglage avancé</span>
        </span>
        <ChevronDown size={18} className="shrink-0 text-ink-muted transition-transform duration-200 group-open/adv:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4">{children}</div>
    </details>
  );
}

export function RenameableAccountsCard({
  accessToken,
  accounts,
  onChanged,
}: {
  accessToken: string | null;
  accounts: GlAccount[];
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comptes personnalisables</CardTitle>
        <CardDescription>
          SYSCOHADA ne fixe pas de numéro officiel pour ces 2 comptes — la pratique varie selon les cabinets
          comptables. Une fois l&apos;avis de votre expert-comptable obtenu, vous pouvez choisir le numéro ici ;
          les écritures déjà enregistrées suivent automatiquement, rien n&apos;est perdu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {RENAMEABLE_SYSTEM_ACCOUNTS.map((meta) => {
          const account = accounts.find((a) => a.systemKey === meta.key);
          return (
            <RenameableAccountRow
              key={meta.key}
              accessToken={accessToken}
              meta={meta}
              currentCode={account?.code ?? meta.defaultCode}
              onChanged={onChanged}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

export function RenameableAccountRow({
  accessToken,
  meta,
  currentCode,
  onChanged,
}: {
  accessToken: string | null;
  meta: (typeof RENAMEABLE_SYSTEM_ACCOUNTS)[number];
  currentCode: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(currentCode);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    if (!editing) setValue(currentCode);
  }, [currentCode, editing]);

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await renameGlSystemAccount(accessToken, meta.key, value.trim());
      setEditing(false);
      toast.success(`Compte « ${meta.label} » renuméroté ${value.trim()}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de renommer ce compte.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-label-md text-ink">{meta.label}</p>
          <p className="text-body-xs text-ink-muted">{meta.hint}</p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className="w-28 tabular"
            />
            <Button size="sm" disabled={submitting || !value.trim()} onClick={handleSave}>
              {submitting ? "…" : "Enregistrer"}
            </Button>
            <Button size="sm" variant="ghost" disabled={submitting} onClick={() => { setEditing(false); setError(null); }}>
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="tabular font-label-md text-ink">{currentCode}</span>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Renuméroter
            </Button>
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-body-xs text-danger-fg">{error}</p>}
    </div>
  );
}

// IRF déjà retenu (compte 442) mais pas encore reversé au fisc — même
// principe que le règlement d'une dépense à crédit (fournisseurs) : une
// dette déjà constatée, ce composant se contente de la solder, jamais de
// générer une nouvelle charge.
export function IrfBalanceCard({ accessToken }: { accessToken: string | null }) {
  const [balance, setBalance] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("virement");
  const [paidAt, setPaidAt] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getIrfBalance(accessToken)
      .then((res) => setBalance(res.balanceOwed))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le solde IRF."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await payIrf(accessToken, { amount: Number(amount), paymentMethod: method, paidAt });
      setPaying(false);
      setAmount("");
      toast.success("IRF reversé au fisc.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce règlement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (balance === null) return null;
  if (balance === 0 && !error) return null;

  return (
    <Card className="border-warning-border bg-warning/5">
      <CardHeader>
        <CardTitle>IRF à reverser au fisc</CardTitle>
        <CardDescription>Retenu sur les reversements aux propriétaires, pas encore reversé à l&apos;État.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <p className="tabular font-currency-table text-headline-sm text-warning-fg">{formatFcfa(balance)}</p>

        {paying ? (
          <form onSubmit={handlePay} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                inputMode="numeric"
                placeholder="Montant"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              />
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={SELECT_CLASS}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={submitting || !amount}>
                {submitting ? "Enregistrement…" : "Confirmer le règlement"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPaying(false)} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="warning" className="self-start" onClick={() => { setAmount(String(balance)); setPaying(true); }}>
            Reverser au fisc
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
