"use client";

import * as React from "react";
import { ArrowLeft, Check, CheckCheck, ChevronDown, FileText, MessageCircle, Paperclip, Pencil, Search, Send, Smile, Trash2, X, Download } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequireAuth } from "@/components/auth/require-auth";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError } from "@/lib/api/client";
import {
  chatConversations, chatThread, chatSend, chatEdit, chatDelete, chatOpenAttachment,
  type ChatContact, type ChatMessage, type ChatThread,
} from "@/lib/api/chat";
import { cn } from "@/lib/utils";

const TZ = "Africa/Porto-Novo";
const MAX_FILE = 10 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx";

const EMOJIS: { label: string; list: string[] }[] = [
  { label: "Visages", list: "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😍 🥰 😘 😎 🤩 🤔 😐 😴 😢 😭 😡 🤯 🥳 😇 🙄 😬 🤗 😋 😜".split(" ") },
  { label: "Gestes", list: "👍 👎 👏 🙌 🙏 💪 👋 🤝 ✌️ 👌 🤞 ☝️ 👉 👈 ✍️ 🫡".split(" ") },
  { label: "Travail", list: "✅ ❌ ⚠️ ❗ ❓ 📌 📎 📝 📅 📞 💰 💵 🧾 🏠 🏢 🔑 📈 📉 ⏰ 🚀 🎉 ❤️ 🔥 ⭐".split(" ") },
];

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso));
function dayLabel(iso: string) {
  const k = dayKey(iso);
  const now = new Date();
  if (k === dayKey(now.toISOString())) return "Aujourd'hui";
  if (k === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso));
}
function listTime(iso: string) {
  const k = dayKey(iso);
  if (k === dayKey(new Date().toISOString())) return timeFmt.format(new Date(iso));
  if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: TZ }).format(new Date(iso));
}
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const HUES = ["bg-emerald-600", "bg-sky-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600"];

function Avatar({ name, url, id, size = 44, token }: { name: string; url: string | null; id: number; size?: number; token: string }) {
  const style = { width: size, height: size };
  const fallback = (
    <div style={style} className={cn("flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white", HUES[id % HUES.length])}>
      {initials(name)}
    </div>
  );
  if (!url) return fallback;
  return <AuthenticatedImage src={url} accessToken={token} alt={name} className="shrink-0 rounded-full object-cover" fallback={fallback} />;
}

export function DiscussionView() {
  return (
    <RequireAuth>
      <DiscussionContent />
    </RequireAuth>
  );
}

function DiscussionContent() {
  const { accessToken } = useAuth();
  const token = accessToken ?? "";
  const [contacts, setContacts] = React.useState<ChatContact[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");

  const loadContacts = React.useCallback(async () => {
    if (!token) return;
    try {
      const r = await chatConversations(token);
      setContacts(r.conversations);
      setError(null);
      window.dispatchEvent(new CustomEvent("aim:chat-unread", { detail: r.unreadTotal }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les discussions.");
    }
  }, [token]);

  // Actualisation périodique (suspendue quand l'onglet est caché).
  React.useEffect(() => {
    loadContacts();
    const t = setInterval(() => { if (!document.hidden) loadContacts(); }, 8000);
    return () => clearInterval(t);
  }, [loadContacts]);

  const filtered = (contacts ?? []).filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const active = contacts?.find((c) => c.userId === activeId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-3.5rem-4px)] overflow-hidden bg-surface lg:h-[calc(100dvh-4px)]">
      {/* Liste des discussions */}
      <aside className={cn("flex w-full flex-col border-r border-border bg-surface lg:w-[360px] lg:shrink-0", activeId !== null && "hidden lg:flex")}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="font-display text-xl font-semibold text-ink">Discussion</h1>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2 rounded-full bg-surface-muted px-3 py-2 text-ink-muted focus-within:ring-2 focus-within:ring-primary/30">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un collègue"
              aria-label="Rechercher un collègue"
              className="w-full bg-transparent text-body-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="px-4 py-3 text-body-sm text-danger">{error}</p>}
          {contacts === null && !error && <p className="px-4 py-6 text-body-sm text-ink-muted">Chargement…</p>}
          {contacts?.length === 0 && <p className="px-4 py-6 text-body-sm text-ink-muted">Aucun collègue avec qui discuter pour le moment. Ajoutez des employés depuis « Employés ».</p>}
          {contacts && contacts.length > 0 && filtered.length === 0 && <p className="px-4 py-6 text-body-sm text-ink-muted">Aucun résultat.</p>}
          {filtered.map((c) => (
            <button
              key={c.userId}
              type="button"
              onClick={() => setActiveId(c.userId)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted",
                c.userId === activeId && "bg-surface-muted",
              )}
            >
              <Avatar name={c.name} url={c.avatarUrl} id={c.userId} token={token} />
              <div className="min-w-0 flex-1 border-b border-border/60 pb-3 -mb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-label-md text-ink">{c.name}</span>
                  {c.last && <span className={cn("shrink-0 text-xs", c.unread ? "font-semibold text-emerald-600" : "text-ink-muted")}>{listTime(c.last.at)}</span>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-body-sm text-ink-muted">
                    {c.last?.mine && !c.last.deleted && (c.last.read ? <CheckCheck size={15} className="shrink-0 text-sky-500" /> : <Check size={15} className="shrink-0" />)}
                    <span className={cn("truncate", c.last?.deleted && "italic")}>{c.last ? c.last.preview : c.roleLabel}</span>
                  </span>
                  {c.unread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white">{c.unread > 99 ? "99+" : c.unread}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <section className={cn("min-w-0 flex-1", activeId === null && "hidden lg:block")}>
        {active ? (
          <Conversation key={active.userId} contact={active} token={token} onBack={() => setActiveId(null)} onChanged={loadContacts} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#f0ebe3] px-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><MessageCircle size={40} /></div>
            <p className="font-display text-xl font-semibold text-ink">Discussion interne</p>
            <p className="max-w-sm text-body-sm text-ink-muted">Choisissez un collègue dans la liste pour lui écrire, lui envoyer un document, une photo ou un emoji. Vos conversations restent privées entre vous deux.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Ticks({ read }: { read: boolean }) {
  return read ? <CheckCheck size={16} className="text-sky-500" aria-label="Lu" /> : <Check size={16} className="text-ink-muted" aria-label="Envoyé" />;
}

function Conversation({ contact, token, onBack, onChanged }: { contact: ChatContact; token: string; onBack: () => void; onChanged: () => void }) {
  const [thread, setThread] = React.useState<ChatThread | null>(null);
  const [older, setOlder] = React.useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<number | null>(null);
  const [toDelete, setToDelete] = React.useState<ChatMessage | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const t = await chatThread(token, contact.userId);
      setThread((prev) => {
        if (!prev) setHasMore(t.hasMore);
        return t;
      });
    } catch { /* silencieux : la liste affiche déjà l'erreur réseau éventuelle */ }
  }, [token, contact.userId]);

  React.useEffect(() => {
    load().then(onChanged);
    const t = setInterval(() => { if (!document.hidden) load().then(onChanged); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const all = React.useMemo(() => {
    const map = new Map<number, ChatMessage>();
    [...older, ...(thread?.messages ?? [])].forEach((m) => map.set(m.id, m));
    return [...map.values()].sort((a, b) => a.id - b.id);
  }, [older, thread]);

  const lastId = thread?.messages.at(-1)?.id;
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [all.length, lastId]);

  React.useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setFilePreview(null); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text]);

  async function loadOlder() {
    if (!all.length) return;
    const el = scroller.current;
    const prevH = el?.scrollHeight ?? 0;
    stick.current = false;
    const t = await chatThread(token, contact.userId, { before: all[0].id });
    setOlder((o) => [...t.messages, ...o]);
    setHasMore(t.hasMore);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH; });
  }

  function pickFile(f: File | null) {
    setErr(null);
    if (!f) return;
    if (f.size > MAX_FILE) { setErr("Fichier trop volumineux (10 Mo maximum)."); return; }
    setFile(f);
  }

  function insertEmoji(e: string) {
    const el = inputRef.current;
    if (!el) { setText((t) => t + e); return; }
    const s = el.selectionStart ?? text.length;
    const en = el.selectionEnd ?? text.length;
    setText(text.slice(0, s) + e + text.slice(en));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + e.length, s + e.length); });
  }

  async function submit() {
    const body = text.trim();
    if (busy) return;
    if (!editing && !body && !file) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        if (body && body !== editing.body) await chatEdit(token, editing.id, body);
        setEditing(null);
      } else {
        stick.current = true;
        await chatSend(token, contact.userId, body, file);
        setFile(null);
      }
      setText("");
      setEmojiOpen(false);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Envoi impossible. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const m = toDelete;
    setToDelete(null);
    if (!m) return;
    try {
      await chatDelete(token, m.id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Suppression impossible.");
    }
  }

  const peerRead = thread?.peerLastReadId ?? 0;

  return (
    <div className="flex h-full flex-col bg-[#f0ebe3]" onClick={() => setMenuFor(null)}>
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2.5">
        <button type="button" onClick={onBack} aria-label="Retour aux discussions" className="rounded-full p-2 text-ink-soft hover:bg-surface-muted lg:hidden">
          <ArrowLeft size={20} />
        </button>
        <Avatar name={contact.name} url={contact.avatarUrl} id={contact.userId} size={40} token={token} />
        <div className="min-w-0">
          <p className="truncate font-label-md text-ink">{contact.name}</p>
          <p className="truncate text-xs text-ink-muted">{contact.roleLabel}</p>
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-[8%]"
      >
        {hasMore && (
          <div className="mb-3 text-center">
            <button type="button" onClick={loadOlder} className="rounded-full bg-white/80 px-3 py-1 text-xs text-ink-soft shadow-sm hover:bg-white">Afficher les messages précédents</button>
          </div>
        )}
        {thread && all.length === 0 && (
          <p className="mx-auto mt-8 max-w-xs rounded-lg bg-amber-100/80 px-3 py-2 text-center text-xs text-amber-900">Aucun message. Écrivez le premier à {contact.name.split(" ")[0]} 👋</p>
        )}
        {all.map((m, i) => {
          const showDay = i === 0 || dayKey(all[i - 1].createdAt) !== dayKey(m.createdAt);
          const sameSender = i > 0 && all[i - 1].senderId === m.senderId && !showDay;
          const read = m.mine && m.id <= peerRead;
          return (
            <React.Fragment key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-lg bg-white/90 px-3 py-1 text-xs font-medium capitalize text-ink-soft shadow-sm">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <div className={cn("group flex", m.mine ? "justify-end" : "justify-start", sameSender ? "mt-0.5" : "mt-2")}>
                <div
                  className={cn(
                    "relative max-w-[85%] rounded-lg px-2.5 py-1.5 text-[15px] leading-snug shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] sm:max-w-[70%]",
                    m.mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white",
                    sameSender && "rounded-tr-lg rounded-tl-lg",
                  )}
                >
                  {m.mine && !m.deleted && (
                    <button
                      type="button"
                      aria-label="Options du message"
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                      className="absolute right-1 top-1 z-10 rounded-full bg-[#d9fdd3]/90 p-0.5 text-ink-muted opacity-100 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <ChevronDown size={16} />
                    </button>
                  )}
                  {menuFor === m.id && (
                    <div onClick={(e) => e.stopPropagation()} className="absolute right-1 top-7 z-20 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 text-body-sm shadow-lg">
                      {m.body !== null && (
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-muted"
                          onClick={() => { setEditing(m); setText(m.body ?? ""); setFile(null); setMenuFor(null); requestAnimationFrame(() => inputRef.current?.focus()); }}>
                          <Pencil size={15} /> Modifier
                        </button>
                      )}
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-surface-muted" onClick={() => { setToDelete(m); setMenuFor(null); }}>
                        <Trash2 size={15} /> Supprimer
                      </button>
                    </div>
                  )}

                  {m.deleted ? (
                    <p className="flex items-center gap-1.5 pr-14 italic text-ink-muted"><X size={14} /> Message supprimé</p>
                  ) : (
                    <>
                      {m.attachment && <Attachment a={m.attachment} token={token} />}
                      {m.body && <p className={cn("whitespace-pre-wrap break-words pr-14", m.attachment && "mt-1")}>{m.body}</p>}
                    </>
                  )}
                  <span className={cn("float-right -mb-0.5 ml-2 mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted", (m.deleted || !m.body) && "absolute bottom-1 right-2 float-none")}>
                    {m.editedAt && !m.deleted && <span>modifié</span>}
                    {timeFmt.format(new Date(m.createdAt))}
                    {m.mine && !m.deleted && <Ticks read={read} />}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Zone de saisie */}
      <div className="border-t border-border bg-surface-muted px-2 py-2">
        {err && <p className="mb-1 px-2 text-xs text-danger">{err}</p>}
        {editing && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-emerald-500 bg-surface px-3 py-1.5 text-xs">
            <Pencil size={14} className="text-emerald-600" />
            <div className="min-w-0 flex-1"><p className="font-semibold text-emerald-700">Modifier le message</p><p className="truncate text-ink-muted">{editing.body}</p></div>
            <button type="button" aria-label="Annuler la modification" onClick={() => { setEditing(null); setText(""); }} className="rounded-full p-1 hover:bg-surface-muted"><X size={16} /></button>
          </div>
        )}
        {file && (
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface px-3 py-2">
            {filePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={filePreview} alt="" className="h-14 w-14 rounded-md object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-md bg-emerald-50 text-emerald-600"><FileText size={26} /></div>
            )}
            <div className="min-w-0 flex-1"><p className="truncate text-body-sm font-medium text-ink">{file.name}</p><p className="text-xs text-ink-muted">{fmtSize(file.size)}</p></div>
            <button type="button" aria-label="Retirer le fichier" onClick={() => setFile(null)} className="rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"><X size={18} /></button>
          </div>
        )}
        {emojiOpen && (
          <div className="mb-2 max-h-52 overflow-y-auto rounded-lg bg-surface p-2 shadow-md">
            {EMOJIS.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{g.label}</p>
                <div className="grid grid-cols-8 sm:grid-cols-12">
                  {g.list.map((e) => (
                    <button key={e} type="button" onClick={() => insertEmoji(e)} className="rounded-md p-1 text-xl hover:bg-surface-muted" aria-label={`Emoji ${e}`}>{e}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button type="button" aria-label="Emoji" onClick={() => setEmojiOpen((v) => !v)} className={cn("rounded-full p-2.5 text-ink-soft hover:bg-surface", emojiOpen && "bg-surface text-emerald-600")}>
            <Smile size={22} />
          </button>
          {!editing && (
            <>
              <button type="button" aria-label="Joindre un fichier" onClick={() => fileRef.current?.click()} className="rounded-full p-2.5 text-ink-soft hover:bg-surface">
                <Paperclip size={22} />
              </button>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </>
          )}
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); submit(); } }}
            placeholder="Écrire un message"
            aria-label="Message"
            className="max-h-[130px] min-h-[44px] flex-1 resize-none rounded-3xl border-0 bg-surface px-4 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-muted"
          />
          <button
            type="button"
            aria-label={editing ? "Enregistrer la modification" : "Envoyer"}
            onClick={submit}
            disabled={busy || (!text.trim() && !file)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editing ? <Check size={20} /> : <Send size={20} />}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        icon={Trash2}
        confirmVariant="danger"
        title="Supprimer ce message ?"
        description="Il sera supprimé pour vous et pour votre collègue. Cette action est définitive."
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function Attachment({ a, token }: { a: NonNullable<ChatMessage["attachment"]>; token: string }) {
  const [err, setErr] = React.useState(false);
  const act = (download: boolean) => chatOpenAttachment(token, a, download).catch(() => setErr(true));
  if (a.isImage) {
    return (
      <button type="button" onClick={() => act(false)} className="block overflow-hidden rounded-md" aria-label={`Ouvrir ${a.name}`}>
        <AuthenticatedImage src={a.url} accessToken={token} alt={a.name} className="max-h-72 w-full min-w-[160px] max-w-[320px] rounded-md bg-black/5 object-cover" fallback={<span className="text-xs text-ink-muted">Image indisponible</span>} />
      </button>
    );
  }
  return (
    <div className="flex min-w-[210px] items-center gap-3 rounded-md bg-black/5 p-2.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-700"><FileText size={22} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-ink">{a.name}</p>
        <p className="text-xs text-ink-muted">{err ? "Fichier indisponible" : fmtSize(a.size)}</p>
      </div>
      <button type="button" onClick={() => act(true)} aria-label={`Télécharger ${a.name}`} className="rounded-full p-2 text-ink-soft hover:bg-black/10"><Download size={18} /></button>
    </div>
  );
}
