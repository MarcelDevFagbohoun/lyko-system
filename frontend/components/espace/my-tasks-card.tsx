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
  ListTodo,
  ArrowRight,
  Send,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getMyTasks, type MyTasks } from "@/lib/api/tasks";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa, formatTaskDueLabel, buildRentReminderMessage, cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Tone = "danger" | "warning" | "info" | "primary";

const TONE_ICON_BG: Record<Tone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
  primary: "bg-primary",
};
const TONE_BORDER: Record<Tone, string> = {
  danger: "border-l-danger-strong",
  warning: "border-l-warning-strong",
  info: "border-l-info",
  primary: "border-l-primary",
};
const TONE_BADGE: Record<Tone, BadgeProps["variant"]> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  primary: "primary",
};

/**
 * Tableau de bord « Mes tâches » (étape 18, demande directe de l'utilisateur
 * pour les comptables et les agents) : rassemble ce qui a besoin d'attention
 * — jusqu'ici éparpillé sur les écrans Relances/Plaintes/Comptabilité/
 * Relevés/États des lieux — en un seul endroit, dès l'arrivée sur `/espace`.
 * Jamais affiché au DG (il a son propre tableau de bord complet) — voir le
 * garde `!isDg` côté appelant.
 *
 * Refonte demandée par l'utilisateur (« pas du tout professionnelle ») :
 * une carte par catégorie (comme le tableau de bord DG — icône colorée,
 * liseré de couleur, lignes cliquables label + détail empilés) au lieu
 * d'une seule carte fourre-tout avec des mini-titres gris en majuscules.
 */
export function MyTasksCard() {
  const { accessToken, tenant } = useAuth();
  const [tasks, setTasks] = React.useState<MyTasks | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    getMyTasks(accessToken)
      .then(setTasks)
      .catch(() => setTasks(null))
      .finally(() => setLoaded(true));
  }, [accessToken]);

  if (!loaded || !tasks || (!tasks.agent && !tasks.accountant && tasks.assignedTasks.length === 0)) return null;

  const monthClosable = tasks.accountant?.currentMonthClosability?.isClosable ?? false;
  const totalCount =
    tasks.assignedTasks.length +
    (tasks.agent
      ? tasks.agent.lateRenters.length +
        tasks.agent.predictiveAlerts.length +
        tasks.agent.openComplaints.length +
        tasks.agent.draftInspections.length
      : 0) +
    (tasks.accountant
      ? tasks.accountant.pendingBatches.length + tasks.accountant.expensesWithoutReceipt.length + (monthClosable ? 1 : 0)
      : 0);

  const assignedTone: Tone = tasks.assignedTasks.some((t) => {
    const u = formatTaskDueLabel(t.dueDate, null).urgency;
    return u === "overdue" || u === "today";
  })
    ? "danger"
    : tasks.assignedTasks.some((t) => formatTaskDueLabel(t.dueDate, null).urgency === "soon")
      ? "warning"
      : "info";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-headline-sm text-ink">Mes tâches</h2>
          <p className="text-body-sm text-ink-soft">Ce qui a besoin de votre attention aujourd&apos;hui.</p>
        </div>
        {totalCount > 0 && <Badge variant="warning">{totalCount}</Badge>}
      </div>

      {totalCount === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-5 text-body-sm text-ink-muted">
            <CheckCircle2 size={16} className="text-success" />
            Rien à signaler pour le moment.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryCard icon={<ListTodo size={14} />} title="Tâches assignées par la direction" tone={assignedTone} count={tasks.assignedTasks.length} href="/espace/taches">
            {tasks.assignedTasks.slice(0, 4).map((t) => {
              const due = formatTaskDueLabel(t.dueDate, null);
              return (
                <Row
                  key={t.id}
                  href="/espace/taches"
                  label={t.title}
                  detail={t.description ?? undefined}
                  badge={<Badge variant={TONE_BADGE[due.urgency === "overdue" || due.urgency === "today" ? "danger" : due.urgency === "soon" ? "warning" : "info"]}>{due.text}</Badge>}
                />
              );
            })}
          </CategoryCard>

          {tasks.agent && (
            <>
              <CategoryCard icon={<AlertTriangle size={14} />} title="Locataires en retard" tone="danger" count={tasks.agent.lateRenters.length} href="/espace/relances">
                {tasks.agent.lateRenters.slice(0, 4).map((r) => (
                  <Row
                    key={r.leaseId}
                    href="/espace/relances"
                    label={`${r.renterName} — ${r.unitCode}`}
                    detail={`${r.daysLate} j de retard`}
                    badge={<Badge variant="danger">{formatFcfa(r.amountOwed)}</Badge>}
                    action={
                      r.phone && (
                        <a
                          href={buildWhatsAppHref(
                            r.phone,
                            buildRentReminderMessage({
                              renterFirstName: r.renterName.split(" ")[0] ?? r.renterName,
                              unitLabel: r.unitCode,
                              monthlyRent: r.monthlyRent,
                              daysLate: r.daysLate,
                              dueDate: r.dueDate,
                              companyName: tenant?.companyName,
                            }),
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Relancer ${r.renterName} sur WhatsApp`}
                          className={buttonVariants({ variant: "whatsapp", size: "sm" })}
                        >
                          <Send size={14} />
                        </a>
                      )
                    }
                  />
                ))}
              </CategoryCard>

              <CategoryCard icon={<BellRing size={14} />} title="Alertes prédictives" tone="warning" count={tasks.agent.predictiveAlerts.length} href="/espace/relances">
                {tasks.agent.predictiveAlerts.slice(0, 4).map((a) => (
                  <Row
                    key={a.leaseId}
                    href="/espace/relances"
                    label={`${a.renterName} — ${a.unitCode}`}
                    detail={`Échéance dans ${a.daysUntilDue} j`}
                  />
                ))}
              </CategoryCard>

              <CategoryCard icon={<MessageSquareWarning size={14} />} title="Plaintes à traiter" tone="danger" count={tasks.agent.openComplaints.length} href="/espace/plaintes">
                {tasks.agent.openComplaints.slice(0, 4).map((c) => (
                  <Row
                    key={c.id}
                    href={`/espace/plaintes/${c.id}`}
                    label={`${c.code} — ${c.title}`}
                    detail={c.renterName}
                    badge={
                      c.priority === "urgente" ? <Badge variant="danger">Urgente</Badge> : <Badge variant="neutral">Normale</Badge>
                    }
                  />
                ))}
              </CategoryCard>

              <CategoryCard icon={<ClipboardList size={14} />} title="États des lieux en brouillon" tone="info" count={tasks.agent.draftInspections.length}>
                {tasks.agent.draftInspections.slice(0, 4).map((d) => (
                  <Row
                    key={`${d.leaseId}-${d.kind}`}
                    href={`/espace/locataires/${d.renterId}/${d.kind === "move-in" ? "etat-des-lieux" : "sortie"}?leaseId=${d.leaseId}`}
                    label={`${d.renterName} — ${d.unitCode}`}
                    detail={d.kind === "move-in" ? "Entrée non finalisée" : "Sortie non finalisée"}
                  />
                ))}
              </CategoryCard>
            </>
          )}

          {tasks.accountant && (
            <>
              <CategoryCard icon={<Gauge size={14} />} title="Relevés à valider" tone="info" count={tasks.accountant.pendingBatches.length} href="/espace/charges/releves">
                {tasks.accountant.pendingBatches.slice(0, 4).map((b) => (
                  <Row
                    key={b.id}
                    href={`/espace/charges/releve/${b.id}`}
                    label={`${b.propertyCode} — ${b.utilityType === "soneb" ? "SONEB" : "SBEE"}`}
                    detail={`${b.periodStart} → ${b.periodEnd}`}
                  />
                ))}
              </CategoryCard>

              <CategoryCard icon={<Receipt size={14} />} title="Dépenses sans justificatif" tone="warning" count={tasks.accountant.expensesWithoutReceipt.length} href="/espace/comptabilite">
                {tasks.accountant.expensesWithoutReceipt.slice(0, 4).map((e) => (
                  <Row key={e.id} label={e.label} detail={e.expenseDate} badge={<Badge variant="neutral">{formatFcfa(e.amount)}</Badge>} />
                ))}
              </CategoryCard>

              {monthClosable && tasks.accountant.currentMonthClosability && (
                <CategoryCard icon={<CalendarClock size={14} />} title="Mois clôturable" tone="primary" count={1} href="/espace/comptabilite">
                  <Row
                    label={`${tasks.accountant.currentMonthClosability.period} est prêt à être clôturé`}
                    detail="Signalez-le à la direction générale, seule habilitée à clôturer."
                  />
                </CategoryCard>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  icon,
  title,
  tone,
  count,
  href,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: Tone;
  count: number;
  href?: string;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Card className={cn("border-l-4", TONE_BORDER[tone])}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white", TONE_ICON_BG[tone])}>
              {icon}
            </span>
            <CardTitle>{title}</CardTitle>
          </div>
          <Badge variant={TONE_BADGE[tone]}>{count}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {children}
        {href && (
          <Link href={href} className="mt-1 inline-flex items-center gap-1 text-body-sm text-primary hover:underline">
            Voir tout <ArrowRight size={14} />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  detail,
  href,
  badge,
  action,
}: {
  label: string;
  detail?: string;
  href?: string;
  badge?: React.ReactNode;
  /** Bouton d'action (ex. relance WhatsApp) — rendu HORS du lien de la ligne
   * pour ne jamais imbriquer un élément cliquable dans un autre. */
  action?: React.ReactNode;
}) {
  const text = (
    <div className="min-w-0">
      <p className="truncate font-label-md text-ink">{label}</p>
      {detail && <p className="truncate text-body-xs text-ink-muted">{detail}</p>}
    </div>
  );
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-hover">
      {href ? (
        <Link href={href} className="min-w-0 flex-1">
          {text}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{text}</div>
      )}
      <div className="flex shrink-0 items-center gap-2">
        {badge}
        {action}
      </div>
    </div>
  );
}
