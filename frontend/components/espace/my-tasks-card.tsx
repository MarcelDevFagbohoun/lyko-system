"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  MessageSquareWarning,
  ClipboardList,
  Gauge,
  Receipt,
  CalendarClock,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getMyTasks, type MyTasks } from "@/lib/api/tasks";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

/**
 * Tableau de bord « Mes tâches » (étape 18, demande directe de l'utilisateur
 * pour les comptables et les agents) : rassemble ce qui a besoin d'attention
 * — jusqu'ici éparpillé sur les écrans Relances/Plaintes/Comptabilité/
 * Relevés/États des lieux — en un seul endroit, dès l'arrivée sur `/espace`.
 * Jamais affiché au DG (il a son propre tableau de bord complet) — voir le
 * garde `!isDg` côté appelant.
 */
export function MyTasksCard() {
  const { accessToken } = useAuth();
  const [tasks, setTasks] = React.useState<MyTasks | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    getMyTasks(accessToken)
      .then(setTasks)
      .catch(() => setTasks(null))
      .finally(() => setLoaded(true));
  }, [accessToken]);

  if (!loaded || !tasks || (!tasks.agent && !tasks.accountant)) return null;

  const monthClosable = tasks.accountant?.currentMonthClosability?.isClosable ?? false;
  const totalCount =
    (tasks.agent
      ? tasks.agent.lateRenters.length +
        tasks.agent.predictiveAlerts.length +
        tasks.agent.openComplaints.length +
        tasks.agent.draftInspections.length
      : 0) +
    (tasks.accountant
      ? tasks.accountant.pendingBatches.length + tasks.accountant.expensesWithoutReceipt.length + (monthClosable ? 1 : 0)
      : 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Mes tâches</CardTitle>
            <CardDescription>Ce qui a besoin de votre attention aujourd&apos;hui.</CardDescription>
          </div>
          {totalCount > 0 && <Badge variant="warning">{totalCount}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {totalCount === 0 ? (
          <p className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
            <CheckCircle2 size={16} className="text-success" />
            Rien à signaler pour le moment.
          </p>
        ) : (
          <>
            {tasks.agent && (
              <>
                <TaskSection
                  icon={<AlertTriangle size={16} className="text-danger-fg" />}
                  title="Locataires en retard"
                  count={tasks.agent.lateRenters.length}
                  href="/espace/relances"
                >
                  {tasks.agent.lateRenters.slice(0, 4).map((r) => (
                    <TaskRow
                      key={r.leaseId}
                      label={`${r.renterName} — ${r.unitCode}`}
                      detail={`${r.daysLate} j de retard · ${formatFcfa(r.amountOwed)}`}
                    />
                  ))}
                </TaskSection>

                <TaskSection
                  icon={<BellRing size={16} className="text-warning-fg" />}
                  title="Alertes prédictives"
                  count={tasks.agent.predictiveAlerts.length}
                  href="/espace/relances"
                >
                  {tasks.agent.predictiveAlerts.slice(0, 4).map((a) => (
                    <TaskRow
                      key={a.leaseId}
                      label={`${a.renterName} — ${a.unitCode}`}
                      detail={`Échéance dans ${a.daysUntilDue} j`}
                    />
                  ))}
                </TaskSection>

                <TaskSection
                  icon={<MessageSquareWarning size={16} className="text-danger-fg" />}
                  title="Plaintes à traiter"
                  count={tasks.agent.openComplaints.length}
                  href="/espace/plaintes"
                >
                  {tasks.agent.openComplaints.slice(0, 4).map((c) => (
                    <TaskRow
                      key={c.id}
                      href={`/espace/plaintes/${c.id}`}
                      label={`${c.code} — ${c.title}`}
                      detail={c.renterName}
                      urgent={c.priority === "urgente"}
                    />
                  ))}
                </TaskSection>

                <TaskSection
                  icon={<ClipboardList size={16} className="text-info-fg" />}
                  title="États des lieux en brouillon"
                  count={tasks.agent.draftInspections.length}
                >
                  {tasks.agent.draftInspections.slice(0, 4).map((d) => (
                    <TaskRow
                      key={`${d.leaseId}-${d.kind}`}
                      href={`/espace/locataires/${d.renterId}/${d.kind === "move-in" ? "etat-des-lieux" : "sortie"}?leaseId=${d.leaseId}`}
                      label={`${d.renterName} — ${d.unitCode}`}
                      detail={d.kind === "move-in" ? "Entrée non finalisée" : "Sortie non finalisée"}
                    />
                  ))}
                </TaskSection>
              </>
            )}

            {tasks.accountant && (
              <>
                <TaskSection
                  icon={<Gauge size={16} className="text-info-fg" />}
                  title="Relevés à valider"
                  count={tasks.accountant.pendingBatches.length}
                  href="/espace/charges/releves"
                >
                  {tasks.accountant.pendingBatches.slice(0, 4).map((b) => (
                    <TaskRow
                      key={b.id}
                      href={`/espace/charges/releve/${b.id}`}
                      label={`${b.propertyCode} — ${b.utilityType === "soneb" ? "SONEB" : "SBEE"}`}
                      detail={`${b.periodStart} → ${b.periodEnd}`}
                    />
                  ))}
                </TaskSection>

                <TaskSection
                  icon={<Receipt size={16} className="text-warning-fg" />}
                  title="Dépenses sans justificatif"
                  count={tasks.accountant.expensesWithoutReceipt.length}
                  href="/espace/comptabilite"
                >
                  {tasks.accountant.expensesWithoutReceipt.slice(0, 4).map((e) => (
                    <TaskRow key={e.id} label={e.label} detail={`${formatFcfa(e.amount)} · ${e.expenseDate}`} />
                  ))}
                </TaskSection>

                {monthClosable && tasks.accountant.currentMonthClosability && (
                  <TaskSection
                    icon={<CalendarClock size={16} className="text-primary" />}
                    title="Mois clôturable"
                    count={1}
                    href="/espace/comptabilite"
                  >
                    <TaskRow
                      label={`${tasks.accountant.currentMonthClosability.period} est prêt à être clôturé`}
                      detail="Signalez-le à la direction générale, seule habilitée à clôturer."
                    />
                  </TaskSection>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TaskSection({
  icon,
  title,
  count,
  href,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  href?: string;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-label-sm uppercase tracking-wider text-ink-muted">
          {icon}
          {title}
          <Badge variant="neutral" className="text-[10px]">
            {count}
          </Badge>
        </div>
        {href && (
          <Link href={href} className="text-body-xs text-primary hover:underline">
            Voir tout
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function TaskRow({
  label,
  detail,
  href,
  urgent,
}: {
  label: string;
  detail: string;
  href?: string;
  urgent?: boolean;
}) {
  const content = (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-body-sm ${
        urgent ? "border-danger-border bg-danger-bg" : "border-border"
      }`}
    >
      <span className="text-ink">{label}</span>
      <span className="text-body-xs text-ink-muted">{detail}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}
