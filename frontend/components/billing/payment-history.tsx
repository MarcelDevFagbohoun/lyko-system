import { FileDown } from "lucide-react";
import { offerLabel, type SubscriptionPayment } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

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
                <span className="text-body-sm text-ink-muted">{p.paidAt ? formatDateLabel(p.paidAt.slice(0, 10)) : "-"}</span>
              </div>
              <p className="text-body-sm text-ink-soft">{paymentLabel(p)} · {p.invoiceNumber ?? "-"}</p>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => onOpenReceipt(p.id)}>
                <FileDown size={14} /> Reçu PDF
              </Button>
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.invoiceNumber ?? "-"}</TableCell>
                  <TableCell>{paymentLabel(p)}</TableCell>
                  <TableCell>{p.paidAt ? formatDateLabel(p.paidAt.slice(0, 10)) : "-"}</TableCell>
                  <TableCell>{formatFcfa(p.amount)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => onOpenReceipt(p.id)}>
                      <FileDown size={14} /> Reçu PDF
                    </Button>
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
