"use client";

import { Wallet, Landmark } from "lucide-react";
import { type EscrowBalance, type DepositsHeld } from "@/lib/api/owners";
import { formatFcfa, cn } from "@/lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";


/** Remplace les cartes financières quand l'employé n'a aucune permission financière sur ce propriétaire
 * (ni `proprietaires`, ni `comptabilite`, ni `locataires`) — la fiche reste consultable (identité,
 * patrimoine) mais le détail des sommes (séquestre, cautions, versements, commission) reste masqué. */
export function RestrictedFinancialsNotice() {
  return (
    <Card tone="slate" accent>
      <CardContent className="flex items-center gap-2.5 py-5 text-body-sm text-ink-muted">
        <Wallet size={16} className="shrink-0" />
        Le détail financier de ce propriétaire (séquestre, cautions, versements, commission) n&apos;est
        visible que par la comptabilité ou un employé avec la permission « Propriétaires »/« Locataires ».
      </CardContent>
    </Card>
  );
}

/**
 * Compte séquestre par mandat (comptabilité simple) : ce que le cabinet
 * détient ACTUELLEMENT pour ce propriétaire — recette nette cumulée depuis
 * toujours (commission déjà déduite), moins les versements déjà effectués.
 * Un solde négatif (versé plus que ce qui a été réellement collecté net)
 * est signalé plutôt que masqué — situation anormale à vérifier.
 */
export function EscrowBalanceCard({
  escrow,
  depositsHeld,
  openingDebtUnpaid,
}: {
  escrow: EscrowBalance | null;
  depositsHeld: DepositsHeld | null;
  openingDebtUnpaid: number;
}) {
  if (!escrow) return null;
  const isNegative = escrow.balance < 0;
  return (
    <Card tone="amber" accent>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark size={18} className="text-primary" />
          Compte séquestre
        </CardTitle>
        <CardDescription>
          Argent collecté pour le compte de ce propriétaire, pas encore reversé.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-body-xs uppercase tracking-wider text-ink-muted">Recette nette cumulée</p>
            <p className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(escrow.totalCollected)}</p>
          </div>
          <div>
            <p className="text-body-xs uppercase tracking-wider text-ink-muted">Déjà reversé</p>
            <p className="tabular font-currency-table text-headline-sm text-ink">{formatFcfa(escrow.totalPayouts)}</p>
          </div>
          <div>
            <p className="text-body-xs uppercase tracking-wider text-ink-muted">Détenu actuellement</p>
            <p className={cn("tabular font-currency-table text-headline-sm", isNegative ? "text-danger-fg" : "text-success-fg")}>
              {formatFcfa(escrow.balance)}
            </p>
          </div>
        </div>
        {isNegative && (
          <p className="mt-3 text-body-xs text-danger-fg">
            Ce propriétaire a reçu plus que sa recette nette cumulée réellement collectée — à vérifier.
          </p>
        )}
        {/* Détail de ce qui compose la recette nette cumulée (étape 42, demande explicite de
            l'utilisateur) — montants BRUTS, avant commission (contrairement aux chiffres ci-dessus). */}
        <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-body-sm">
          <p className="mb-0.5 font-label-sm uppercase tracking-wider text-ink-muted">
            Dont, avant commission
          </p>
          <div className="flex items-center justify-between text-ink-soft">
            <span>Loyers encaissés</span>
            <span className="tabular">{formatFcfa(escrow.breakdown.rent)}</span>
          </div>
          {escrow.breakdown.openingDebt > 0 && (
            <div className="flex items-center justify-between text-ink-soft">
              <span>Dette initiale réglée</span>
              <span className="tabular">{formatFcfa(escrow.breakdown.openingDebt)}</span>
            </div>
          )}
          {escrow.breakdown.prorata > 0 && (
            <div className="flex items-center justify-between text-ink-soft">
              <span>Prorata d&apos;entrée</span>
              <span className="tabular">{formatFcfa(escrow.breakdown.prorata)}</span>
            </div>
          )}
          {(escrow.chargeCredits ?? 0) > 0 && (
            <div className="flex items-center justify-between text-ink-soft">
              <span>Charges SONEB/SBEE créditées au solde</span>
              <span className="tabular">{formatFcfa(escrow.chargeCredits ?? 0)}</span>
            </div>
          )}
          {escrow.breakdown.expenses > 0 && (
            <div className="flex items-center justify-between text-ink-soft">
              <span>Dépenses rattachées à ses Biens</span>
              <span className="tabular">− {formatFcfa(escrow.breakdown.expenses)}</span>
            </div>
          )}
        </div>
        {/* Cautions détenues (demande utilisateur, 2026-10-17) — ligne distincte, JAMAIS mélangée à la
            recette nette cumulée ci-dessus : une caution n'est pas un revenu, c'est l'argent du
            locataire, conservé puis restitué (voir `getDepositsHeldByOwner`, backend). */}
        {depositsHeld && depositsHeld.total > 0 && (
          <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-body-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm uppercase tracking-wider text-ink-muted">Cautions détenues</span>
              <span className="tabular font-currency-table text-ink">{formatFcfa(depositsHeld.total)}</span>
            </div>
            {depositsHeld.breakdown.depositLoyer > 0 && (
              <div className="flex items-center justify-between text-ink-soft">
                <span>Caution de loyer</span>
                <span className="tabular">{formatFcfa(depositsHeld.breakdown.depositLoyer)}</span>
              </div>
            )}
            {depositsHeld.breakdown.sbee > 0 && (
              <div className="flex items-center justify-between text-ink-soft">
                <span>Caution SBEE</span>
                <span className="tabular">{formatFcfa(depositsHeld.breakdown.sbee)}</span>
              </div>
            )}
            {depositsHeld.breakdown.soneb > 0 && (
              <div className="flex items-center justify-between text-ink-soft">
                <span>Caution SONEB</span>
                <span className="tabular">{formatFcfa(depositsHeld.breakdown.soneb)}</span>
              </div>
            )}
            {depositsHeld.breakdown.peinture > 0 && (
              <div className="flex items-center justify-between text-ink-soft">
                <span>Caution peinture</span>
                <span className="tabular">{formatFcfa(depositsHeld.breakdown.peinture)}</span>
              </div>
            )}
          </div>
        )}

        {/* Ligne distincte, jamais mélangée aux chiffres ci-dessus (décision
            explicite de l'utilisateur) : de l'argent pas encore réellement
            collecté ne doit jamais se confondre avec le solde réel détenu. */}
        {openingDebtUnpaid > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5">
            <span className="text-body-sm text-warning-fg">Impayés de locataire(s) à l&apos;entrée</span>
            <span className="tabular font-currency-table text-warning-fg">{formatFcfa(openingDebtUnpaid)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Archive des propriétaires (demande utilisateur, 2026-10-18) : contrairement à un bail, rien
 * n'indiquait jusqu'ici qu'un propriétaire avait quitté le cabinet — action VOLONTAIRE du DG
 * (jamais automatique sur « 0 Bien »), motif obligatoire, bloquée tant qu'il reste au moins un Bien
 * rattaché. Une fois le mandat terminé, la fiche devient en LECTURE SEULE (décision explicite) —
 * cette carte reste la seule porte de sortie (« Réactiver le mandat »), pour un règlement tardif
 * par exemple.
 */
