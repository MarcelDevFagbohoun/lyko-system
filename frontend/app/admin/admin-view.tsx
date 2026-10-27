"use client";

import * as React from "react";
import QRCode from "qrcode";
import { ApiError } from "@/lib/api/client";
import {
  adminLogin, adminMe, adminTenants, adminRefunds, adminPaymentIssues, adminApprove, adminReject, adminPay, adminMarkPaid, adminRefresh, adminGrant, adminSetInternal, adminRevokePartner,
  admin2faSetup, admin2faEnable, admin2faDisable, adminAudit,
  getAdminToken, setAdminToken, type AdminTenant, type AuditEntry,
} from "@/lib/api/admin";
import { ACCOUNT_TYPE_LABELS, type PlanKey, type Refund } from "@/lib/api/billing";
import type { PaymentIssue } from "@/lib/api/admin";
import { offerLabel } from "@/lib/api/billing";
import { CatalogEditor } from "./catalog-editor";
import { PartnerDialog } from "./partner-dialog";
import { PartnerBadge } from "@/components/billing/partner-badge";
import { PAYMENT_OUTCOME } from "@/lib/billing-plans";
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
  const [code, setCode] = React.useState("");
  const [needCode, setNeedCode] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await adminLogin(email, password, code)).token);
    } catch (err) {
      if (err instanceof ApiError && err.message === "Code de vérification requis") {
        setNeedCode(true);
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Connexion impossible.");
      }
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
            {needCode && (
              <Field label="Code de votre application d'authentification" htmlFor="ac" hint="6 chiffres, renouvelés toutes les 30 secondes">
                <Input id="ac" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
              </Field>
            )}
            {error && <p className="text-body-sm text-danger-fg">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Connexion…" : needCode ? "Valider le code" : "Se connecter"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  requested: { label: "À examiner", variant: "warning" },
  approved: { label: "Acceptée, attente coordonnées", variant: "info" },
  details_received: { label: "Prête à payer", variant: "info" },
  processing: { label: "Virement en cours", variant: "warning" },
  paid: { label: "Remboursée", variant: "success" },
  rejected: { label: "Refusée", variant: "neutral" },
  failed: { label: "Virement en échec", variant: "danger" },
};

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = React.useState<"refunds" | "payments" | "tenants" | "catalog" | "security" | "audit">("refunds");
  const [refunds, setRefunds] = React.useState<Refund[]>([]);
  const [issues, setIssues] = React.useState<PaymentIssue[]>([]);
  const [refs, setRefs] = React.useState<Record<number, string>>({});
  const [tenants, setTenants] = React.useState<AdminTenant[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [fees, setFees] = React.useState<Record<number, string>>({});
  const [notes, setNotes] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");
  const [dialog, setDialog] = React.useState<{ kind: "grant" | "internal"; tenant: AdminTenant } | null>(null);
  const [partnerDialog, setPartnerDialog] = React.useState<AdminTenant | null>(null);

  const load = React.useCallback(() => {
    Promise.all([adminRefunds(token), adminTenants(token), adminPaymentIssues(token)])
      .then(([r, t, i]) => { setRefunds(r.refunds); setTenants(t.tenants); setIssues(i.issues); })
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
          <div className="flex flex-wrap gap-2">
            <Button variant={tab === "refunds" ? "primary" : "secondary"} onClick={() => setTab("refunds")}>Remboursements</Button>
            <Button variant={tab === "payments" ? "primary" : "secondary"} onClick={() => setTab("payments")}>
              Paiements à surveiller{issues.some((i) => i.status === "anomaly") ? " ⚠" : issues.length ? ` (${issues.length})` : ""}
            </Button>
            <Button variant={tab === "tenants" ? "primary" : "secondary"} onClick={() => setTab("tenants")}>Entreprises</Button>
            <Button variant={tab === "catalog" ? "primary" : "secondary"} onClick={() => setTab("catalog")}>Offres et prix</Button>
            <Button variant={tab === "audit" ? "primary" : "secondary"} onClick={() => setTab("audit")}>Journal</Button>
            <Button variant={tab === "security" ? "primary" : "secondary"} onClick={() => setTab("security")}>Sécurité</Button>
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
                    {r.kind === "cancellation" && r.daysRemaining !== null && (
                      <p className="text-body-sm text-ink-soft">Annulation : {r.daysRemaining} jour(s) restant(s), prorata calculé sur {formatFcfa(r.amountOriginal ?? 0)} → base de remboursement <strong>{formatFcfa(r.amountPaid)}</strong></p>
                    )}
                    {r.kind === "guarantee" && <p className="text-body-sm text-ink-soft">Remboursement intégral du premier paiement (garantie).</p>}
                    {r.refundAmount !== null && <p className="text-body-sm text-ink-soft">Frais retenus {formatFcfa(r.feeAmount ?? 0)} → à rembourser <strong>{formatFcfa(r.refundAmount)}</strong></p>}
                    {r.payeeName && (
                      <p className="text-body-sm text-ink-soft">
                        Bénéficiaire : {r.payeeFirstName} {r.payeeName} · {r.payeeAccountType ? ACCOUNT_TYPE_LABELS[r.payeeAccountType] : r.payeeOperator?.toUpperCase()}
                        {r.payeeOtherDetail ? ` (${r.payeeOtherDetail})` : ""} · {r.payeeAccountNumber ?? r.payeePhone}
                        {r.payeeAccountLabel ? ` · Intitulé : ${r.payeeAccountLabel}` : ""}
                      </p>
                    )}
                    {r.paidManually && <p className="text-body-sm text-ink-soft">Payé manuellement.</p>}
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
                    {r.status === "details_received" && (
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label="Référence du virement (paiement manuel)" htmlFor={`ref${r.id}`}>
                          <Input id={`ref${r.id}`} value={refs[r.id] ?? ""} onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })} />
                        </Field>
                        <Button variant="secondary" disabled={busy === r.id || (refs[r.id] ?? "").trim().length < 3} onClick={() => run(r.id, () => adminMarkPaid(token, r.id, refs[r.id].trim()), "Remboursement marqué comme payé, le client est prévenu.")}>Marquer comme payé</Button>
                      </div>
                    )}
                    {((r.status === "details_received" && (r.payeeAccountType === "mtn" || r.payeeAccountType === "moov" || !r.payeeAccountType)) || r.status === "failed") && (
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

        {tab === "payments" && (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-muted">Paiements d&apos;abonnement des 30 derniers jours qui n&apos;ont pas abouti. Une anomalie signifie que de l&apos;argent a été encaissé sans activer l&apos;abonnement : à vérifier en priorité dans FedaPay.</p>
            {issues.length === 0 && <p className="text-body-md text-ink-muted">Rien à signaler.</p>}
            {issues.map((i) => (
              <Card key={i.id}>
                <CardContent className="flex flex-col gap-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-label-md text-ink">{i.companyName} · {i.planKey} · {i.months} mois{i.kind === "upgrade" ? " (changement d'offre)" : ""}</p>
                    <p className="text-body-sm text-ink-muted">{formatDateLabel(i.createdAt.slice(0, 10))} · {formatFcfa(i.amount)}{i.creditApplied ? ` (crédit ${formatFcfa(i.creditApplied)})` : ""}</p>
                    <p className="break-all font-mono text-body-xs text-ink-faint">{i.reference}</p>
                  </div>
                  <Badge variant={i.status === "anomaly" ? "danger" : i.status === "pending" ? "warning" : "neutral"}>
                    {i.status === "anomaly" ? "Anomalie : montant différent" : i.status === "pending" ? "Non terminé" : i.reason === "declined" ? "Refusé" : i.reason === "canceled" ? "Annulé" : i.reason === "abandoned" ? "Abandonné" : "Échoué"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "catalog" && <CatalogEditor token={token} />}
        {tab === "audit" && <AuditPanel token={token} />}
        {tab === "security" && <SecurityPanel token={token} />}

        {tab === "tenants" && (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Input aria-label="Rechercher une entreprise" placeholder="Rechercher une entreprise…" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
                <p className="text-body-xs text-ink-muted">
                  « interne » = accès complet sans limite ni échéance (vos entreprises actuelles). « Attribuer une offre » en fait un client payant.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entreprise</TableHead><TableHead>Offre</TableHead><TableHead>Statut</TableHead><TableHead>Échéance</TableHead><TableHead>Payé</TableHead><TableHead>Dernier paiement</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.filter((t) => t.companyName.toLowerCase().includes(search.trim().toLowerCase())).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        {t.companyName}{t.founderPrice ? " ★" : ""}
                        {t.overLimits?.length > 0 && <div className="text-body-xs text-warning-fg">Dépasse son offre : {t.overLimits.join(", ")}</div>}
                      </TableCell>
                      <TableCell>
                        {t.planKey === "interne" ? "interne (accès complet)" : t.planKey === "partenaire" ? <PartnerBadge /> : t.planKey ?? "—"}
                        {t.partner && <div className="mt-1 max-w-[16rem] text-body-xs text-ink-muted">{t.partner.features.length - 1} fonction(s) en plus de la base{t.partner.note ? ` · ${t.partner.note}` : ""}</div>}
                      </TableCell>
                      <TableCell>{t.status}</TableCell>
                      <TableCell>{t.currentPeriodEnd ? formatDateLabel(t.currentPeriodEnd.slice(0, 10)) : "—"}</TableCell>
                      <TableCell>{formatFcfa(t.totalPaid)}</TableCell>
                      <TableCell>{t.lastPayment ? <Badge variant={PAYMENT_OUTCOME[t.lastPayment].variant}>{PAYMENT_OUTCOME[t.lastPayment].label}</Badge> : "—"}</TableCell>
                      <TableCell>
                       <div className="flex flex-col items-start gap-1 lg:flex-row lg:items-center">
                        <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "grant", tenant: t })}>Attribuer une offre</Button>
                        <Button variant="ghost" size="sm" onClick={() => setPartnerDialog(t)}>{t.planKey === "partenaire" && t.status === "active" ? "Modifier le partenariat" : "Abonnement partenaire"}</Button>
                        {t.planKey !== "interne" && (
                          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "internal", tenant: t })}>Passer en interne</Button>
                        )}
                       </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      {partnerDialog && (
        <PartnerDialog
          tenant={partnerDialog}
          token={token}
          onClose={() => setPartnerDialog(null)}
          onDone={(ok) => { setPartnerDialog(null); setMessage(ok); load(); }}
          onRevoke={(note) => {
            const t = partnerDialog;
            setPartnerDialog(null);
            run(t.id, () => adminRevokePartner(token, t.id, note), `Partenariat terminé pour ${t.companyName}.`);
          }}
        />
      )}
      {dialog && (
        <TenantDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSubmit={(fn, ok) => {
            const id = dialog.tenant.id;
            setDialog(null);
            run(id, fn, ok);
          }}
          token={token}
        />
      )}
    </div>
  );
}

const GRANT_MONTHS: Record<PlanKey, number[]> = { demarrage: [1, 2], pro: [4, 12], entreprise: [12], interne: [] } as Record<PlanKey, number[]>;

function TenantDialog({ dialog, onClose, onSubmit, token }: {
  dialog: { kind: "grant" | "internal"; tenant: AdminTenant };
  onClose: () => void;
  onSubmit: (fn: () => Promise<unknown>, ok: string) => void;
  token: string;
}) {
  const [plan, setPlan] = React.useState<PlanKey>("pro");
  const [months, setMonths] = React.useState(4);
  const [note, setNote] = React.useState(dialog.kind === "grant" ? "Geste commercial" : "Compte de démonstration");
  const t = dialog.tenant;
  const valid = note.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{dialog.kind === "grant" ? `Attribuer une offre — ${t.companyName}` : `Passer en interne — ${t.companyName}`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {dialog.kind === "grant" ? (
            <>
              <Field label="Offre" htmlFor="gp">
                <select id="gp" className="h-10 rounded border border-border bg-surface px-3 text-body-md" value={plan} onChange={(e) => { const p = e.target.value as PlanKey; setPlan(p); setMonths(GRANT_MONTHS[p][0] ?? 1); }}>
                  <option value="demarrage">Démarrage</option>
                  <option value="pro">Pro</option>
                  <option value="entreprise">Entreprise</option>
                </select>
              </Field>
              <Field label="Durée" htmlFor="gm" hint="Doit correspondre à une durée proposée pour cette offre">
                <select id="gm" className="h-10 rounded border border-border bg-surface px-3 text-body-md" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                  {[1, 2, 4, 12].map((m) => <option key={m} value={m}>{offerLabel(m)}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <p className="text-body-sm text-ink-soft">Cette entreprise aura un accès complet, sans limite ni échéance.</p>
          )}
          <Field label="Motif (conservé dans le journal)" htmlFor="gn">
            <Input id="gn" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button
              disabled={!valid}
              onClick={() =>
                dialog.kind === "grant"
                  ? onSubmit(() => adminGrant(token, t.id, plan, months, note.trim()), `Offre attribuée à ${t.companyName} (${offerLabel(months)}).`)
                  : onSubmit(() => adminSetInternal(token, t.id, note.trim()), `${t.companyName} est maintenant en offre interne.`)
              }
            >
              Confirmer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  login: "Connexion", login_failed: "Connexion refusée", login_2fa_failed: "Code 2FA refusé", "2fa_enabled": "2FA activée", "2fa_disabled": "2FA désactivée",
  refund_approve: "Remboursement accepté", refund_reject: "Remboursement refusé", refund_pay: "Virement de remboursement",
  tenant_grant: "Offre attribuée", tenant_partner_grant: "Abonnement partenaire attribué", tenant_partner_extend: "Abonnement partenaire prolongé", tenant_partner_revoke: "Partenariat terminé", tenant_set_internal: "Passage en interne", catalog_save: "Offres modifiées", catalog_reset: "Offres réinitialisées",
};

function AuditPanel({ token }: { token: string }) {
  const [entries, setEntries] = React.useState<AuditEntry[] | null>(null);
  React.useEffect(() => { adminAudit(token).then((r) => setEntries(r.entries)).catch(() => setEntries([])); }, [token]);
  if (!entries) return null;
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Administrateur</TableHead><TableHead>Action</TableHead><TableHead>Cible</TableHead><TableHead>IP</TableHead></TableRow></TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{new Date(e.createdAt).toLocaleString("fr-FR")}</TableCell>
                <TableCell>{e.adminEmail ?? "—"}</TableCell>
                <TableCell>{ACTION_LABELS[e.action] ?? e.action}</TableCell>
                <TableCell>{e.target ?? "—"}</TableCell>
                <TableCell>{e.ip ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {entries.length === 0 && <p className="mt-3 text-body-sm text-ink-muted">Aucune action enregistrée.</p>}
      </CardContent>
    </Card>
  );
}

function SecurityPanel({ token }: { token: string }) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [setup, setSetup] = React.useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => { adminMe(token).then((m) => setEnabled(m.twoFactor)).catch(() => setEnabled(false)); }, [token]);
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? e.message : "Action impossible.");

  if (enabled === null) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Double authentification</CardTitle></CardHeader>
      <CardContent className="flex max-w-md flex-col gap-4">
        {msg && <p className="text-body-sm text-ink">{msg}</p>}
        {!enabled && !setup && (
          <>
            <p className="text-body-sm text-ink-soft">
              Protège le back-office même si votre mot de passe est volé : à chaque connexion, un code à 6 chiffres de votre téléphone est demandé.
            </p>
            <Button className="self-start" onClick={() => admin2faSetup(token).then(async (r) => setSetup({ ...r, qr: await QRCode.toDataURL(r.uri, { width: 200, margin: 1 }) })).catch(fail)}>Activer</Button>
          </>
        )}
        {!enabled && setup && (
          <>
            <p className="text-body-sm text-ink-soft">Scannez ce code avec Google Authenticator, Authy ou Microsoft Authenticator, puis saisissez le code affiché.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code à scanner" width={200} height={200} />
            <p className="break-all text-body-xs text-ink-muted">Saisie manuelle : {setup.secret}</p>
            <Field label="Code à 6 chiffres" htmlFor="tc"><Input id="tc" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Button className="self-start" onClick={() => admin2faEnable(token, code).then(() => { setEnabled(true); setSetup(null); setCode(""); setMsg("Double authentification activée."); }).catch(fail)}>Confirmer</Button>
          </>
        )}
        {enabled && (
          <>
            <p className="text-body-sm text-success-fg">La double authentification est active.</p>
            <Field label="Mot de passe" htmlFor="dp"><Input id="dp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Code actuel" htmlFor="dc"><Input id="dc" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Button variant="danger" className="self-start" onClick={() => admin2faDisable(token, password, code).then(() => { setEnabled(false); setPassword(""); setCode(""); setMsg("Double authentification désactivée."); }).catch(fail)}>Désactiver</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
