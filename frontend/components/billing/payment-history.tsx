import { FileDown } from "lucide-react";
import { offerLabel, type SubscriptionPayment } from "@/lib/api/billing";
import { PAYMENT_OUTCOME } from "@/lib/billing-plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

function paymentDate(p: SubscriptionPayment) {
  const d = p.paidAt ?? p.createdAt;
  return d ? formatDateLabel(d.slice(0, 10)) : "-";
}

function OutcomeBadge({ p }: { p: SubscriptionPayment }) {
  const o = PAYMENT_OUTCOME[p.outcome];
  return <Badge variant={o.variant}>{o.label}</Badge>;
}

function paymentLabel(p: SubscriptionPayment) {
  return `${p.planLabel} · ${offerLabel(p.months)}${p.kind === "upgrade" ? " (changement d'offre)" : ""}${p.status === "refunded" ? " (remboursé)" : ""}`;
}

/** Historique des paiements d'abonnement avec reçu PDF : cartes sur téléphone, tableau dès `sm`. */
export function PaymentHistory({ payments, onOpenReceipt }: { payments: SubscriptionPayment[]; onOpenReceipt: (id: number) => void }) {
  if (payments.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Historique des paiements</CardTitle></CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border sm:hidden">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-label-md text-ink">{formatFcfa(p.amount)}</span>
                <span className="flex items-center gap-2"><OutcomeBadge p={p} /><span className="text-body-sm text-ink-muted">{paymentDate(p)}</span></span>
              </div>
              <p className="text-body-sm text-ink-soft">{paymentLabel(p)} · {p.invoiceNumber ?? "-"}</p>
              {p.outcome === "success" && (
                <Button variant="secondary" size="sm" className="self-start" onClick={() => onOpenReceipt(p.id)}>
                  <FileDown size={14} /> Reçu PDF
                </Button>
              )}
              {p.outcome === "incomplete" && <p className="text-body-xs text-ink-faint">Paiement commencé mais non terminé : choisissez de nouveau l&apos;offre pour le reprendre.</p>}
            </li>
          ))}
        </ul>
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reçu</TableHead>
                <TableHead>Offre</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.invoiceNumber ?? "-"}</TableCell>
                  <TableCell>{paymentLabel(p)}</TableCell>
                  <TableCell>{paymentDate(p)}</TableCell>
                  <TableCell>{formatFcfa(p.amount)}</TableCell>
                  <TableCell><OutcomeBadge p={p} /></TableCell>
                  <TableCell>
                    {p.outcome === "success" && (
                      <Button variant="ghost" size="sm" onClick={() => onOpenReceipt(p.id)}>
                        <FileDown size={14} /> Reçu PDF
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
