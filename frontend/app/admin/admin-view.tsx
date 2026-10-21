"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import {
  adminLogin, adminMe, adminTenants, adminRefunds, adminApprove, adminReject, adminPay, adminRefresh, adminGrant,
  getAdminToken, setAdminToken, type AdminTenant,
} from "@/lib/api/admin";
import type { PlanKey, Refund } from "@/lib/api/billing";
import { offerLabel } from "@/lib/api/billing";
import { CatalogEditor } from "./catalog-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

/**
 * Back-office de la plateforme (équipe Africa Immo Management). Authentification séparée de l'espace client ; le jeton vit dans
 * sessionStorage (fermé avec l'onglet, expire en 8 h). Aucune donnée métier des clients n'y est affichée.
 */
export function AdminView() {
  const [token, setToken] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const t = getAdminToken();
    if (!t) { setReady(true); return; }
    adminMe(t).then(() => setToken(t)).catch(() => setAdminToken(null)).finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!token) return <Login onDone={(t) => { setAdminToken(t); setToken(t); }} />;
  return <Dashboard token={token} onLogout={() => { setAdminToken(null); setToken(null); }} />;
}

function Login({ onDone }: { onDone: (t: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await adminLogin(email, password)).token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Back-office Africa Immo Management</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="E-mail" htmlFor="ae"><Input id="ae" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Mot de passe" htmlFor="ap"><Input id="ap" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  requested: { label: "À examiner", variant: "warning" },
  approved: { label: "Acceptée — attente coordonnées", variant: "info" },
  details_received: { label: "Prête à payer", variant: "info" },
  processing: { label: "Virement en cours", variant: "warning" },
  paid: { label: "Remboursée", variant: "success" },
  rejected: { label: "Refusée", variant: "neutral" },
  failed: { label: "Virement en échec", variant: "danger" },
};

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = React.useState<"refunds" | "tenants" | "catalog">("refunds");
  const [refunds, setRefunds] = React.useState<Refund[]>([]);
  const [tenants, setTenants] = React.useState<AdminTenant[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [fees, setFees] = React.useState<Record<number, string>>({});
  const [notes, setNotes] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    Promise.all([adminRefunds(token), adminTenants(token)])
      .then(([r, t]) => { setRefunds(r.refunds); setTenants(t.tenants); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) onLogout(); else setMessage(e instanceof ApiError ? e.message : "Chargement impossible."); });
  }, [token, onLogout]);
  React.useEffect(() => load(), [load]);

  async function run(id: number, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    setMessage(null);
    try { await fn(); setMessage(ok); load(); } catch (e) { setMessage(e instanceof ApiError ? e.message : "Action impossible."); } finally { setBusy(null); }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-headline-lg text-ink">Back-office</h1>
          <div className="flex gap-2">
            <Button variant={tab === "refunds" ? "primary" : "secondary"} onClick={() => setTab("refunds")}>Remboursements</Button>
            <Button variant={tab === "tenants" ? "primary" : "secondary"} onClick={() => setTab("tenants")}>Entreprises</Button>
            <Button variant={tab === "catalog" ? "primary" : "secondary"} onClick={() => setTab("catalog")}>Offres et prix</Button>
            <Button variant="ghost" onClick={onLogout}>Déconnexion</Button>
          </div>
        </div>
        {message && <p className="rounded border border-border bg-surface p-3 text-body-sm text-ink">{message}</p>}

        {tab === "refunds" && (
          <div className="flex flex-col gap-4">
            {refunds.length === 0 && <p className="text-body-md text-ink-muted">Aucune demande de remboursement.</p>}
            {refunds.map((r) => {
              const b = STATUS_BADGE[r.status] ?? { label: r.status, variant: "neutral" as const };
              return (
                <Card key={r.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{r.companyName}</CardTitle>
                      <Badge variant={b.variant}>{b.label}</Badge>
                      <span className="text-body-sm text-ink-muted">{formatDateLabel(r.createdAt.slice(0, 10))} · payé {formatFcfa(r.amountPaid)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-body-sm text-ink-soft"><span className="font-label-md text-ink">Raison :</span> {r.reason}</p>
                    {r.refundAmount !== null && <p className="text-body-sm text-ink-soft">Frais retenus {formatFcfa(r.feeAmount ?? 0)} → à rembourser <strong>{formatFcfa(r.refundAmount)}</strong></p>}
                    {r.payeeName && <p className="text-body-sm text-ink-soft">Bénéficiaire : {r.payeeName} · {r.payeeOperator?.toUpperCase()} {r.payeePhone}</p>}
                    {r.status === "requested" && (
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label="Frais FedaPay retenus (FCFA)" htmlFor={`f${r.id}`} hint="Vide = estimation automatique">
                          <Input id={`f${r.id}`} inputMode="numeric" value={fees[r.id] ?? ""} onChange={(e) => setFees({ ...fees, [r.id]: e.target.value })} />
                        </Field>
                        <Field label="Note / motif de refus" htmlFor={`n${r.id}`}>
                          <Input id={`n${r.id}`} value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                        </Field>
                        <Button disabled={busy === r.id} onClick={() => run(r.id, () => adminApprove(token, r.id, fees[r.id] ? Number(fees[r.id]) : undefined, notes[r.id] || undefined), "Remboursement accepté : le client a reçu son lien par e-mail.")}>Accepter</Button>
                        <Button variant="danger" disabled={busy === r.id} onClick={() => run(r.id, () => adminReject(token, r.id, notes[r.id] ?? ""), "Demande refusée, le client est prévenu.")}>Refuser</Button>
                      </div>
                    )}
                    {(r.status === "details_received" || r.status === "failed") && (
                      <Button className="self-start" disabled={busy === r.id} onClick={() => run(r.id, async () => { const x = await adminPay(token, r.id); setMessage(`Virement : ${x.status}`); }, "Virement lancé.")}>
                        Envoyer {r.refundAmount !== null ? formatFcfa(r.refundAmount) : "le virement"}
                      </Button>
                    )}
                    {r.status === "processing" && (
                      <Button variant="secondary" className="self-start" disabled={busy === r.id} onClick={() => run(r.id, () => adminRefresh(token, r.id), "État du virement actualisé.")}>Actualiser l&apos;état</Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "catalog" && <CatalogEditor token={token} />}

        {tab === "tenants" && (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entreprise</TableHead><TableHead>Offre</TableHead><TableHead>Statut</TableHead><TableHead>Échéance</TableHead><TableHead>Payé</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.companyName}{t.founderPrice ? " ★" : ""}</TableCell>
                      <TableCell>{t.planKey ?? "—"}</TableCell>
                      <TableCell>{t.status}</TableCell>
                      <TableCell>{t.currentPeriodEnd ? formatDateLabel(t.currentPeriodEnd.slice(0, 10)) : "—"}</TableCell>
                      <TableCell>{formatFcfa(t.totalPaid)}</TableCell>
                      <TableCell>
                        {t.planKey !== "interne" && (
                          <Button variant="ghost" size="sm" onClick={() => {
                            const plan = window.prompt("Offre à attribuer (demarrage / pro / entreprise) :", "pro") as PlanKey | null;
                            const months = Number(window.prompt("Durée en mois (1, 2, 4 ou 12 selon l'offre) :", "4"));
                            const note = window.prompt("Motif de l'attribution :", "Geste commercial");
                            if (plan && months && note) run(t.id, () => adminGrant(token, t.id, plan, months, note), `Offre attribuée à ${t.companyName} (${offerLabel(months)}).`);
                          }}>Attribuer</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
