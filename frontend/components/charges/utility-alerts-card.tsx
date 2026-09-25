"use client";

import * as React from "react";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, BellRing, CheckCircle2, Info } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getUtilityAlerts, type UtilityAlert } from "@/lib/api/charges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<UtilityAlert["severity"], { icon: React.ElementType; border: string; iconCls: string }> = {
  danger: { icon: AlertOctagon, border: "border-l-danger-strong", iconCls: "text-danger-fg" },
  warning: { icon: AlertTriangle, border: "border-l-warning-strong", iconCls: "text-warning-fg" },
  info: { icon: Info, border: "border-l-info", iconCls: "text-info-fg" },
};

/**
 * Alertes du suivi des charges SONEB/SBEE (étape 31) : ce qui, faute d'action,
 * fait perdre de l'argent au propriétaire ou laisse son carnet incomplet —
 * relevé manquant ou en brouillon, facture mère jamais déclarée payée, écart
 * anormal, charges encaissées à reverser. Calculées à la volée côté serveur.
 * `hideWhenEmpty` : sur l'accueil, aucune place n'est prise quand tout va bien.
 */
export function UtilityAlertsCard({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { accessToken } = useAuth();
  const [alerts, setAlerts] = React.useState<UtilityAlert[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    getUtilityAlerts(accessToken)
      .then((r) => setAlerts(r.alerts))
      .catch(() => setFailed(true));
  }, [accessToken]);

  if (failed || alerts === null) return null;
  if (alerts.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-body-sm text-ink-muted">
          <CheckCircle2 size={16} className="text-success" />
          Aucune alerte sur le suivi des charges : relevés à jour, factures mères déclarées, rien à reverser en retard.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing size={18} className="text-warning-fg" />
          Alertes du suivi des charges
          <Badge variant="warning">{alerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {alerts.map((a) => {
          const style = SEVERITY_STYLE[a.severity];
          const Icon = style.icon;
          return (
            <Link
              key={a.key}
              href={a.href}
              className={cn(
                "group flex items-start gap-3 rounded-lg border border-border border-l-4 bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted",
                style.border,
              )}
            >
              <Icon size={16} className={cn("mt-0.5 shrink-0", style.iconCls)} />
              <div className="min-w-0 flex-1">
                <p className="font-label-md text-ink">{a.title}</p>
                <p className="text-body-xs text-ink-muted">{a.detail}</p>
              </div>
              <ArrowRight size={14} className="mt-1 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
