"use client";

import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Scale,
  Droplets,
  AlertTriangle,
  UserPlus,
  Tag,
} from "lucide-react";
import { type AccountingDashboard, type CardKey } from "@/lib/api/accounting";
import { formatFcfa } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";


// Chaque carte reprend la teinte de son statut réel (vert = favorable, rouge
// = défavorable, orange = à surveiller) — la couleur porte l'information,
// jamais seule (icône + libellé toujours présents), tokens Badge/charte.
export function DashboardCards({ dashboard, onOpen }: { dashboard: AccountingDashboard; onOpen: (card: CardKey) => void }) {
  const { totals } = dashboard;
  return (
    <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Loyers encaissés"
        onClick={() => onOpen("rent")}
        icon={<TrendingUp size={16} />}
        value={formatFcfa(totals.rentCollected)}
        tone={totals.rentCollected > 0 ? "success" : "default"}
        trend={{ value: `${totals.rentCollectedCount} paiement(s)`, direction: "flat" }}
      />
      <StatCard
        label="Frais d'agence à l'entrée"
        onClick={() => onOpen("entryFees")}
        icon={<UserPlus size={16} />}
        value={formatFcfa(totals.entryFeesCollected)}
        tone={totals.entryFeesCollected > 0 ? "success" : "default"}
        trend={{ value: `${totals.entryFeesCollectedCount} locataire(s) — produit de l'entreprise, jamais reversé`, direction: "flat" }}
      />
      <StatCard
        label="Commission sur ventes de biens"
        onClick={() => onOpen("saleCommissions")}
        icon={<Tag size={16} />}
        value={formatFcfa(totals.saleCommissionsCollected)}
        tone={totals.saleCommissionsCollected > 0 ? "success" : "default"}
        trend={{ value: `${totals.saleCommissionsCollectedCount} vente(s) — produit de l'entreprise, jamais reversé`, direction: "flat" }}
      />
      <StatCard
        label="Autres entrées"
        onClick={() => onOpen("otherIncomes")}
        icon={<TrendingUp size={16} />}
        value={formatFcfa(totals.otherIncomes)}
        tone={totals.otherIncomes > 0 ? "success" : "default"}
        trend={{ value: `${totals.otherIncomesCount} entrée(s) — honoraires, intérêts, remboursements…`, direction: "flat" }}
      />
      <StatCard
        label="Versé aux propriétaires"
        onClick={() => onOpen("ownerPayouts")}
        icon={<TrendingDown size={16} />}
        value={formatFcfa(totals.ownerPayouts)}
        tone={totals.ownerPayouts > 0 ? "success" : "default"}
        trend={{ value: `${totals.ownerPayoutsCount} versement(s)`, direction: "flat" }}
      />
      <StatCard
        label="Dépenses de l'entreprise"
        onClick={() => onOpen("expenses")}
        icon={<Wallet size={16} />}
        value={formatFcfa(totals.expenses)}
        tone={totals.expenses > 0 ? "warning" : "default"}
        trend={{ value: `${totals.expensesCount} dépense(s)`, direction: "flat" }}
      />
      <StatCard
        label="Travaux facturés aux biens"
        onClick={() => onOpen("propertyExpenses")}
        icon={<Wallet size={16} />}
        value={formatFcfa(totals.propertyExpenses)}
        tone="info"
        trend={{ value: `${totals.propertyExpensesCount} dépense(s), à la charge des propriétaires`, direction: "flat" }}
      />
      <StatCard
        label="Impayés SONEB/SBEE"
        onClick={() => onOpen("unpaidCharges")}
        icon={<Droplets size={16} />}
        value={formatFcfa(totals.unpaidCharges)}
        tone={totals.unpaidChargesCount > 0 ? "danger" : "success"}
        trend={{ value: `${totals.unpaidChargesCount} facture(s)`, direction: "flat" }}
      />
      <StatCard
        label="Impayés locataires"
        onClick={() => onOpen("tenantArrears")}
        icon={<AlertTriangle size={16} />}
        value={formatFcfa(totals.tenantArrears)}
        tone={totals.tenantArrearsCount > 0 ? "danger" : "success"}
        trend={{ value: `${totals.tenantArrearsCount} locataire(s) en retard`, direction: "flat" }}
      />
      <StatCard
        label={totals.treasuryNet != null ? "Trésorerie réelle" : "Solde net"}
        onClick={() => onOpen("treasury")}
        icon={<Scale size={16} />}
        value={formatFcfa(totals.treasuryNet ?? totals.netCashFlow)}
        tone={(totals.treasuryNet ?? totals.netCashFlow) >= 0 ? "success" : "danger"}
        trend={{
          value:
            totals.treasuryNet != null
              ? `${formatFcfa(totals.treasuryIn ?? 0)} entrés − ${formatFcfa(totals.treasuryOut ?? 0)} sortis, argent des propriétaires inclus (le résultat de l'entreprise est à part)`
              : "Encaissé + frais d'agence + commission vente, moins reversé et dépenses de l'entreprise",
          direction: (totals.treasuryNet ?? totals.netCashFlow) >= 0 ? "up" : "down",
        }}
      />
    </div>
  );
}

