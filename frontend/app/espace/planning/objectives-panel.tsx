"use client";

import * as React from "react";
import { Plus, Target, Trash2, Pencil, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import {
  createObjective, updateObjective, deleteObjective, addKeyResult, updateKeyResult, deleteKeyResult,
  type Objective, type PlanningPerson,
} from "@/lib/api/planning";
import { Hint, Modal, ProgressBar, fmtDate, areaCls, selectCls, todayBenin } from "./planning-shared";

const fmtNum = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);

export function ObjectivesPanel({
  token, objectives, people, canAssign, defaultOwner, onChanged,
}: {
  token: string; objectives: Objective[]; people: PlanningPerson[]; canAssign: boolean; defaultOwner: number; onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<Objective | "new" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Hint icon={<Target size={15} />} className="max-w-3xl">
          <span>
            Un <strong>objectif</strong> dit où l&apos;on veut aller sur une période (ex. « Réduire les impayés »). Ses <strong>résultats clés</strong> sont les chiffres qui prouvent qu&apos;on y est
            (ex. « Taux de recouvrement : 95 % »). Mettez à jour la valeur « Actuel » au fil du temps : le pourcentage d&apos;avancement se calcule tout seul.
            Sans résultat clé, l&apos;avancement suit les tâches rattachées à l&apos;objectif.
          </span>
        </Hint>
        <Button className="w-full sm:w-auto" onClick={() => setEditing("new")}><Plus size={16} /> Nouvel objectif</Button>
      </div>
      {objectives.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Target className="mx-auto mb-2 text-ink-muted" />
          <p className="text-body-md text-ink">Aucun objectif pour le moment.</p>
          <p className="text-body-sm text-ink-muted">Fixez un objectif pour le mois ou le trimestre (bouton « Nouvel objectif »), ajoutez-y un ou deux résultats clés chiffrés, puis rattachez-y vos tâches.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {objectives.map((o) => <ObjectiveCard key={o.id} o={o} token={token} onChanged={onChanged} onEdit={() => setEditing(o)} />)}
      </div>
      {editing && (
        <ObjectiveDialog token={token} objective={editing === "new" ? null : editing} people={people} canAssign={canAssign} defaultOwner={defaultOwner}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}

function ObjectiveCard({ o, token, onChanged, onEdit }: { o: Objective; token: string; onChanged: () => void; onEdit: () => void }) {
  const [krForm, setKrForm] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Action impossible."); }
  };
  const ended = o.endDate < todayBenin();
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-ink">{o.title}</h3>
          <p className="text-body-sm text-ink-muted">
            {fmtDate(o.startDate)} → {fmtDate(o.endDate)}{ended && o.progress < 100 && <span className="ml-1 text-danger">· période terminée</span>}
            {o.owner.id !== o.createdBy.id && <span className="ml-2 inline-flex items-center gap-1"><UserRound size={12} />{o.owner.name} (fixé par {o.createdBy.name})</span>}
          </p>
        </div>
        <span className="font-display text-2xl font-semibold text-ink">{o.progress}%</span>
        {o.canEdit && <button type="button" onClick={onEdit} aria-label="Modifier l'objectif" className="rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"><Pencil size={16} /></button>}
      </header>
      <ProgressBar value={o.progress} />
      {o.description && <p className="text-body-sm text-ink-soft">{o.description}</p>}

      <ul className="flex flex-col gap-2">
        {o.keyResults.map((k) => (
          <li key={k.id} className="rounded-lg bg-surface-muted/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-body-md text-ink">{k.title}</p>
              {o.canEdit && <button type="button" aria-label="Supprimer le résultat clé" onClick={() => run(() => deleteKeyResult(token, k.id))} className="text-ink-muted hover:text-danger"><Trash2 size={14} /></button>}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <ProgressBar value={k.progress} className="h-1.5" />
              <span className="w-10 shrink-0 text-right text-xs text-ink-muted">{k.progress}%</span>
            </div>
            <CurrentValue k={k} onSave={(v) => run(() => updateKeyResult(token, k.id, { currentValue: v }))} />
          </li>
        ))}
      </ul>

      {o.canEdit && (krForm
        ? <KeyResultForm onCancel={() => setKrForm(false)} onSubmit={async (v) => { await run(() => addKeyResult(token, o.id, v)); setKrForm(false); }} />
        : <button type="button" onClick={() => setKrForm(true)} className="self-start text-body-sm text-primary hover:underline">+ Ajouter un résultat clé</button>)}

      <footer className="text-xs text-ink-muted">
        {o.tasksTotal > 0 ? `${o.tasksDone}/${o.tasksTotal} tâche(s) terminée(s)` : "Aucune tâche rattachée"}
        {o.keyResults.length === 0 && o.tasksTotal > 0 && " — l'avancement suit les tâches (ajoutez un résultat clé pour le mesurer en chiffres)"}
      </footer>
      {err && <p className="text-body-sm text-danger" role="alert">{err}</p>}
    </article>
  );
}

function CurrentValue({ k, onSave }: { k: Objective["keyResults"][number]; onSave: (v: number) => void }) {
  const [v, setV] = React.useState(String(k.currentValue));
  React.useEffect(() => setV(String(k.currentValue)), [k.currentValue]);
  const commit = () => {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n !== k.currentValue) onSave(n); else setV(String(k.currentValue));
  };
  return (
    <div className="mt-1.5 flex items-center gap-2 text-body-sm text-ink-soft">
      <span>Actuel</span>
      <input
        value={v}
        inputMode="decimal"
        aria-label={`Valeur actuelle : ${k.title}`}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
        className="h-8 w-24 rounded border border-border-strong bg-surface px-2 text-right text-body-sm text-ink"
      />
      <span>/ {fmtNum(k.targetValue)} {k.unit ?? ""}</span>
    </div>
  );
}

function KeyResultForm({ onSubmit, onCancel }: { onSubmit: (v: { title: string; unit: string | null; targetValue: number; currentValue: number }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [cur, setCur] = React.useState("0");
  const ok = title.trim().length >= 2 && Number(target.replace(",", ".")) > 0;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit({ title, unit: unit.trim() || null, targetValue: Number(target.replace(",", ".")), currentValue: Number(cur.replace(",", ".")) || 0 }); }}
      className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-4"
    >
      <p className="col-span-2 text-body-sm text-ink-muted sm:col-span-4">Un résultat clé est un chiffre à atteindre : la <strong>cible</strong> (ex. 95), son <strong>unité</strong> (%, FCFA, dossiers…) et la valeur de <strong>départ</strong> (ex. 0).</p>
      <div className="col-span-2 sm:col-span-4"><Input placeholder="Résultat à atteindre (ex. Taux de recouvrement)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Résultat clé" maxLength={200} /></div>
      <Input placeholder="Cible" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Cible" />
      <Input placeholder="Unité (%, FCFA…)" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unité" maxLength={20} />
      <Input placeholder="Départ" inputMode="decimal" value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Valeur de départ" />
      <div className="flex gap-1.5"><Button type="submit" size="sm" disabled={!ok}>Ajouter</Button><Button type="button" size="sm" variant="ghost" onClick={onCancel}>Annuler</Button></div>
    </form>
  );
}

function ObjectiveDialog({
  token, objective, people, canAssign, defaultOwner, onClose, onSaved,
}: { token: string; objective: Objective | null; people: PlanningPerson[]; canAssign: boolean; defaultOwner: number; onClose: () => void; onSaved: () => void }) {
  const t = todayBenin();
  const [title, setTitle] = React.useState(objective?.title ?? "");
  const [description, setDescription] = React.useState(objective?.description ?? "");
  const [startDate, setStartDate] = React.useState(objective?.startDate ?? `${t.slice(0, 8)}01`);
  const [endDate, setEndDate] = React.useState(objective?.endDate ?? "");
  const [ownerId, setOwnerId] = React.useState(objective?.owner.id ?? defaultOwner);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fe, setFe] = React.useState<Record<string, string[]>>({});
  const [confirmDel, setConfirmDel] = React.useState(false);

  // Raccourcis de période : mois en cours / trimestre en cours.
  function preset(kind: "mois" | "trimestre") {
    const [y, m] = t.split("-").map(Number);
    const sm = kind === "mois" ? m - 1 : Math.floor((m - 1) / 3) * 3;
    const em = kind === "mois" ? m - 1 : sm + 2;
    setStartDate(new Date(Date.UTC(y, sm, 1)).toISOString().slice(0, 10));
    setEndDate(new Date(Date.UTC(y, em + 1, 0)).toISOString().slice(0, 10));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setFe({});
    try {
      const input = { title, description: description.trim() || null, startDate, endDate, ...(canAssign ? { ownerId } : {}) };
      if (objective) await updateObjective(token, objective.id, input); else await createObjective(token, input);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); setFe(err.details ?? {}); } else setError("Enregistrement impossible.");
      setBusy(false);
    }
  }
  async function remove() {
    if (!objective) return;
    setBusy(true);
    try { await deleteObjective(token, objective.id); onSaved(); } catch (err) { setError(err instanceof ApiError ? err.message : "Suppression impossible."); setBusy(false); }
  }

  return (
    <Modal title={objective ? "Modifier l'objectif" : "Nouvel objectif"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Objectif" htmlFor="ob-title" required error={fe.title?.[0]} hint="Une phrase qui dit ce que vous voulez obtenir. Vous ajouterez les chiffres (résultats clés) ensuite.">
          <Input id="ob-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={200} placeholder="Ex. Réduire les loyers impayés" />
        </Field>
        <Field label="Description" htmlFor="ob-desc">
          <textarea id="ob-desc" rows={2} className={areaCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <p className="text-body-sm text-ink-muted">Période de l&apos;objectif :</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => preset("mois")}>Ce mois</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => preset("trimestre")}>Ce trimestre</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début" htmlFor="ob-start" required error={fe.startDate?.[0]}><Input id="ob-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Fin" htmlFor="ob-end" required error={fe.endDate?.[0]}><Input id="ob-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        {canAssign && (
          <Field label="Pour" htmlFor="ob-owner" hint="Vous pouvez fixer un objectif à un collègue : il pourra mettre à jour les valeurs, sans changer les cibles.">
            <select id="ob-owner" className={selectCls} value={ownerId} onChange={(e) => setOwnerId(Number(e.target.value))}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.me ? `Moi (${p.name})` : `${p.name} — ${p.roleLabel}`}</option>)}
            </select>
          </Field>
        )}
        {error && <p className="text-body-sm text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {objective ? (confirmDel ? (
            <span className="flex items-center gap-2 text-body-sm">Supprimer ?
              <Button type="button" variant="danger" size="sm" onClick={remove} disabled={busy}>Oui</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>Non</Button>
            </span>
          ) : <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDel(true)}><Trash2 size={15} /> Supprimer</Button>) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={busy || title.trim().length < 2 || !startDate || !endDate}>{objective ? "Enregistrer" : "Créer"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
