"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  ListTodo,
  Lock,
  MessageSquareWarning,
  Receipt,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getMyTasks, type MyTasks } from "@/lib/api/tasks";
import { getClosingOverview, type ClosingOverview } from "@/lib/api/accounting";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatFcfa, monthLabelFr } from "@/lib/utils";

/**
 * « À faire maintenant » (étape 55) : en haut de l'accueil de CHAQUE rôle (DG, comptable, agent),
 * les quelques actions qui comptent le plus, triées par urgence, chacune avec un message qui dit
 * quoi faire et un bouton qui y mène directement. Construit uniquement à partir des données déjà
 * calculées par le serveur (`GET /api/tasks`, `GET /api/accounting/closing-overview`) : chaque rôle ne
 * voit que ce que ses permissions lui ouvrent. La liste complète reste sur la page Tâches.
 */

type Severity = "urgent" | "attention" | "info";

type PriorityItem = {
  key: string;
  severity: Severity;
  icon: LucideIcon;
  title: string;
  detail: string;
  cta: string;
  href: string;
};

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, attention: 1, info: 2 };

const SEVERITY_STYLE: Record<Severity, { stripe: string; chip: string; label: string }> = {
  urgent: { stripe: "bg-danger", chip: "bg-danger text-white", label: "Urgent" },
  attention: { stripe: "bg-warning", chip: "bg-warning text-white", label: "À faire" },
  info: { stripe: "bg-info", chip: "bg-info text-white", label: "Conseillé" },
};

const MAX_ITEMS = 5;

function plural(n: number, one: string, many: string) {
  return n > 1 ? many : one;
}

function buildItems(tasks: MyTasks | null, closing: ClosingOverview | null, isDg: boolean): PriorityItem[] {
  const items: PriorityItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  if (tasks?.agent) {
    const late = tasks.agent.lateRenters;
    if (late.length > 0) {
      const total = late.reduce((s, a) => s + a.amountOwed, 0);
      items.push({
        key: "retards",
        severity: "urgent",
        icon: AlertTriangle,
        title: `${late.length} ${plural(late.length, "locataire est", "locataires sont")} en retard de loyer`,
        detail: `${formatFcfa(total)} à récupérer. Une relance WhatsApp se prépare en un clic.`,
        cta: "Relancer",
        href: "/espace/relances",
      });
    }
    const urgentComplaints = tasks.agent.openComplaints.filter((c) => c.priority === "urgente");
    if (urgentComplaints.length > 0) {
      items.push({
        key: "plaintes-urgentes",
        severity: "urgent",
        icon: MessageSquareWarning,
        title: `${urgentComplaints.length} ${plural(urgentComplaints.length, "plainte urgente attend", "plaintes urgentes attendent")} une réponse`,
        detail: urgentComplaints.length === 1 ? `${urgentComplaints[0].title} — ${urgentComplaints[0].renterName}` : "Le locataire attend un retour rapide.",
        cta: "Traiter",
        href: urgentComplaints.length === 1 ? `/espace/plaintes/${urgentComplaints[0].id}` : "/espace/plaintes",
      });
    }
    const drafts = tasks.agent.draftInspections;
    if (drafts.length > 0) {
      const d = drafts[0];
      items.push({
        key: "etats-des-lieux",
        severity: "attention",
        icon: ClipboardCheck,
        title: `${drafts.length} ${plural(drafts.length, "état des lieux à finaliser", "états des lieux à finaliser")}`,
        detail: "Tant qu'il n'est pas signé, il n'a aucune valeur en cas de litige.",
        cta: "Finaliser",
        href:
          drafts.length === 1
            ? `/espace/locataires/${d.renterId}/${d.kind === "move-in" ? "etat-des-lieux" : "sortie"}?leaseId=${d.leaseId}`
            : "/espace/taches",
      });
    }
    const predicted = tasks.agent.predictiveAlerts;
    if (predicted.length > 0) {
      items.push({
        key: "previsions",
        severity: "info",
        icon: BellRing,
        title: `${predicted.length} ${plural(predicted.length, "locataire risque", "locataires risquent")} d'être en retard`,
        detail: "Habitués aux retards, échéance proche : un rappel amical maintenant évite l'impayé.",
        cta: "Prévenir",
        href: "/espace/relances",
      });
    }
  }

  if (closing?.next && !closing.next.isCurrentMonth) {
    const backlog = closing.months.filter((m) => m.status === "pret" || m.status === "en_attente" || m.status === "a_suivre").length;
    if (closing.next.isClosable || backlog >= 2) {
      const label = monthLabelFr(closing.next.month);
      items.push({
        key: "cloture",
        severity: backlog >= 2 ? "urgent" : "attention",
        icon: Lock,
        title: backlog >= 2 ? `${backlog} mois terminés ne sont pas clôturés` : `${label.charAt(0).toUpperCase()}${label.slice(1)} est prêt à être clôturé`,
        detail: isDg ? `Commencez par ${label} : la page vous guide pas à pas.` : `Préparez les vérifications : seule la direction peut clôturer.`,
        cta: isDg ? `Clôturer ${label}` : "Préparer",
        href: "/espace/cloture",
      });
    }
  }

  if (tasks?.accountant) {
    const batches = tasks.accountant.pendingBatches;
    if (batches.length > 0) {
      items.push({
        key: "releves",
        severity: "attention",
        icon: Gauge,
        title: `${batches.length} ${plural(batches.length, "relevé SONEB/SBEE à valider", "relevés SONEB/SBEE à valider")}`,
        detail: "Les locataires ne sont pas facturés tant que le relevé reste en brouillon.",
        cta: "Valider",
        href: batches.length === 1 ? `/espace/charges/releve/${batches[0].id}` : "/espace/charges/releves",
      });
    }
    const deposits = tasks.accountant.pendingDepositRegularizations;
    if (deposits.length > 0) {
      items.push({
        key: "cautions",
        severity: "attention",
        icon: ShieldAlert,
        title: `${deposits.length} ${plural(deposits.length, "retenue sur caution à comptabiliser", "retenues sur caution à comptabiliser")}`,
        detail: "La sortie est finalisée, mais la retenue n'apparaît pas encore en comptabilité.",
        cta: "Régulariser",
        href: deposits.length === 1 ? `/espace/locataires/${deposits[0].renterId}/sortie?leaseId=${deposits[0].leaseId}` : "/espace/taches",
      });
    }
    const receipts = tasks.accountant.expensesWithoutReceipt;
    if (receipts.length > 0) {
      items.push({
        key: "justificatifs",
        severity: "info",
        icon: Receipt,
        title: `${receipts.length} ${plural(receipts.length, "dépense sans justificatif", "dépenses sans justificatif")}`,
        detail: "Joignez les reçus avant la clôture du mois : après, plus rien ne pourra être modifié.",
        cta: "Joindre",
        href: "/espace/comptabilite#depenses",
      });
    }
  }

  for (const t of tasks?.assignedTasks ?? []) {
    const overdue = t.dueDate < today;
    const dueToday = t.dueDate === today;
    if (!overdue && !dueToday) continue;
    items.push({
      key: `tache-${t.id}`,
      severity: overdue ? "urgent" : "attention",
      icon: ListTodo,
      title: overdue ? `Tâche en retard : ${t.title}` : `À faire aujourd'hui : ${t.title}`,
      detail: t.description ?? "Tâche confiée par la direction.",
      cta: "Ouvrir",
      href: "/espace/taches",
    });
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function PriorityPanel() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const canClosing = isDg || (user?.permissions.includes("comptabilite") ?? false);
  const [tasks, setTasks] = React.useState<MyTasks | null>(null);
  const [closing, setClosing] = React.useState<ClosingOverview | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    Promise.allSettled([getMyTasks(accessToken), canClosing ? getClosingOverview(accessToken) : Promise.resolve(null)]).then(
      ([t, c]) => {
        if (t.status === "fulfilled") setTasks(t.value);
        if (c.status === "fulfilled") setClosing(c.value);
        setLoaded(true);
      },
    );
  }, [accessToken, canClosing]);

  if (!loaded) return null;

  const items = buildItems(tasks, closing, isDg);
  const urgentCount = items.filter((i) => i.severity === "urgent").length;
  const shown = items.slice(0, MAX_ITEMS);
  const hidden = items.length - shown.length;

  if (items.length === 0) {
    return (
      <Card className="border-success-border bg-success-bg/60">
        <CardContent className="flex items-center gap-3 py-4">
          <span className="flex h-10 w-10 shrink-0 animate-cell-pop items-center justify-center rounded-full bg-success text-white">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <p className="font-label-md text-ink">Tout est à jour</p>
            <p className="text-body-sm text-ink-soft">Rien d&apos;urgent pour l&apos;instant : aucun retard, aucune tâche en attente.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 border-b border-border">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            À faire maintenant
          </CardTitle>
          <CardDescription>Les actions les plus importantes du moment, de la plus urgente à la moins pressée.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {urgentCount > 0 && (
            <Badge variant="danger" dot>
              {urgentCount} {plural(urgentCount, "urgente", "urgentes")}
            </Badge>
          )}
          <Badge variant="neutral">
            {items.length} {plural(items.length, "action", "actions")}
          </Badge>
        </div>
      </CardHeader>
      <ul className="flex flex-col">
        {shown.map((item, i) => {
          const style = SEVERITY_STYLE[item.severity];
          const Icon = item.icon;
          return (
            <li
              key={item.key}
              className="group relative flex animate-slide-in-left flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:flex-nowrap sm:px-5"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.stripe)} />
              <span className={cn("relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full", style.chip)}>
                {item.severity === "urgent" && (
                  <span aria-hidden className="absolute inset-0 animate-urgent-ping rounded-full bg-danger" />
                )}
                <Icon size={17} className="relative" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-label-md text-ink">
                  {item.title}
                  <span className="text-body-xs font-normal uppercase tracking-wider text-ink-muted">{style.label}</span>
                </p>
                <p className="text-body-sm text-ink-soft">{item.detail}</p>
              </div>
              <Link
                href={item.href}
                className={cn(
                  buttonVariants({ variant: item.severity === "urgent" ? "primary" : "secondary" }),
                  "w-full shrink-0 justify-center sm:w-auto",
                )}
              >
                {item.cta}
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <div className="border-t border-border bg-surface-muted px-5 py-2.5 text-right">
          <Link href="/espace/taches" className="text-body-sm text-primary hover:underline">
            Voir les {hidden} autres actions
          </Link>
        </div>
      )}
    </Card>
  );
}
