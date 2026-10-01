"use client";

import * as React from "react";
import { ArrowLeft, History, Loader2, Plus, Send, Sparkles, Square, Trash2, UserRound, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import {
  deleteAssistantConversation,
  deleteAssistantProfile,
  fetchAssistantStatus,
  getAssistantConversation,
  listAssistantConversations,
  saveAssistantProfile,
  streamAssistantChat,
  type AssistantConversationSummary,
  type AssistantStatus,
} from "@/lib/api/assistant";
import { SafeMarkdown } from "@/components/assistant/safe-markdown";
import { cn } from "@/lib/utils";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

const MAX_LENGTH = 2000;

// Questions que l'assistant sait traiter à l'étape A (aide sur la plateforme, sans données du cabinet).
const SUGGESTIONS = [
  "Comment enregistrer un paiement partiel ?",
  "Comment relancer un locataire en retard ?",
  "Comment fonctionne le point des charges SONEB/SBEE ?",
  "Comment clôturer un mois ?",
];

// Fonctions proposées d'un clic lors de la prise de connaissance (en plus du titre du poste du compte).
const TITLE_CHOICES = ["Directeur / Directrice", "Gestionnaire", "Comptable", "Agent immobilier"];
const ONBOARDING_SKIP_KEY = "lyko-assistant-onboarding-skipped";

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

/**
 * Assistant IA — bouton flottant + panneau de discussion. N'apparaît que si le serveur dit qu'il est
 * utilisable pour CET utilisateur (activé par la direction, permission, clé configurée) : sinon la
 * plateforme est strictement identique à avant.
 */
export function AssistantWidget() {
  const { accessToken } = useAuth();
  const [status, setStatus] = React.useState<AssistantStatus | null>(null);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<"chat" | "history" | "profile">("chat");
  // Prise de connaissance : « name » puis « title » tant que l'assistant ne connaît pas la personne.
  const [onboarding, setOnboarding] = React.useState<null | "name" | "title">(null);
  const [draftName, setDraftName] = React.useState("");
  const [profileName, setProfileName] = React.useState("");
  const [profileTitle, setProfileTitle] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = React.useState<number | null>(null);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  // Précise ce que l'assistant fait pendant qu'il travaille (ex. « Consultation des loyers en retard… »)
  // — absent = simple réflexion générique.
  const [thinkingLabel, setThinkingLabel] = React.useState<string | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<AssistantConversationSummary[] | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetchAssistantStatus(accessToken)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null)); // hors connexion ou erreur : le bouton reste simplement masqué
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Première ouverture sans profil mémorisé : l'assistant fait connaissance (sauf si la personne a dit « plus tard »).
  const needsIntro = !!status?.available && status.profile === null;
  React.useEffect(() => {
    if (!open || !needsIntro || onboarding !== null || messages.length > 0 || view !== "chat") return;
    try {
      if (sessionStorage.getItem(ONBOARDING_SKIP_KEY)) return;
    } catch {
      /* stockage indisponible : on propose quand même */
    }
    setOnboarding("name");
    setMessages([{ id: nextId(), role: "assistant", content: "Bonjour ! Je suis l'assistant Lyko. Pour mieux vous aider, comment dois-je vous appeler ?" }]);
  }, [open, needsIntro, onboarding, messages.length, view]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking, view, onboarding]);

  React.useEffect(() => {
    if (open && view === "chat") inputRef.current?.focus();
  }, [open, view]);

  // Échap ferme le panneau.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Quitter la page ou se déconnecter : on coupe la réponse en cours (elle ne coûterait plus rien d'utile).
  React.useEffect(() => () => abortRef.current?.abort(), []);

  if (!status?.available || !accessToken) return null;

  const remaining = status.usage.remaining;
  const quotaExhausted = remaining <= 0;

  function resetConversation() {
    abortRef.current?.abort();
    setOnboarding(null);
    setMessages([]);
    setConversationId(null);
    setError(null);
    setSending(false);
    setThinking(false);
    setThinkingLabel(undefined);
    setView("chat");
  }

  function say(role: "user" | "assistant", content: string) {
    setMessages((prev) => [...prev, { id: nextId(), role, content }]);
  }

  function skipIntro() {
    try {
      sessionStorage.setItem(ONBOARDING_SKIP_KEY, "1");
    } catch {
      /* sans conséquence */
    }
    setOnboarding(null);
    setMessages([]);
  }

  async function answerIntro(raw: string) {
    const text = raw.trim();
    if (!text || !accessToken) return;
    setError(null);
    setInput("");
    if (onboarding === "name") {
      setDraftName(text);
      say("user", text);
      say("assistant", `Enchanté, ${text}. Quelle est votre fonction ?`);
      setOnboarding("title");
      return;
    }
    say("user", text);
    setSending(true);
    try {
      const profile = await saveAssistantProfile(accessToken, { displayName: draftName, jobTitle: text });
      setStatus((s) => (s ? { ...s, profile } : s));
      setOnboarding(null);
      say("assistant", `Merci ${profile.displayName}, je m'en souviendrai. Vous pouvez modifier ou effacer ces informations à tout moment avec l'icône de profil en haut.`);
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.details ?? {}).flat()[0] ?? err.message : "Enregistrement impossible.");
      setMessages((prev) => prev.slice(0, -1)); // la réponse n'est pas partie : on la retire pour la redemander
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function openProfile() {
    setError(null);
    setProfileName(status?.profile?.displayName ?? status?.suggestions?.displayName ?? "");
    setProfileTitle(status?.profile?.jobTitle ?? status?.suggestions?.jobTitle ?? "");
    setView("profile");
  }

  async function saveProfile() {
    if (!accessToken) return;
    setError(null);
    try {
      const profile = await saveAssistantProfile(accessToken, { displayName: profileName, jobTitle: profileTitle });
      setStatus((s) => (s ? { ...s, profile } : s));
      setView("chat");
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.details ?? {}).flat()[0] ?? err.message : "Enregistrement impossible.");
    }
  }

  async function forgetProfile() {
    if (!accessToken) return;
    if (!window.confirm("Effacer votre nom et votre fonction de la mémoire de l'assistant ?")) return;
    try {
      await deleteAssistantProfile(accessToken);
      setStatus((s) => (s ? { ...s, profile: null } : s));
      try {
        sessionStorage.setItem(ONBOARDING_SKIP_KEY, "1"); // pas de nouvelle prise de contact immédiate
      } catch {
        /* sans conséquence */
      }
      setView("chat");
    } catch {
      setError("Suppression impossible.");
    }
  }

  async function send(raw: string) {
    if (onboarding) return answerIntro(raw);
    const text = raw.trim();
    if (!text || sending || !accessToken) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("L'assistant nécessite une connexion à internet.");
      return;
    }
    setError(null);
    setInput("");
    setSending(true);
    setThinking(true);
    setThinkingLabel(undefined);
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    const replyId = nextId();
    setMessages((prev) => [...prev, userMsg, { id: replyId, role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamAssistantChat(
        accessToken,
        { message: text, ...(conversationId ? { conversationId } : {}) },
        {
          onThinking: (label) => {
            setThinking(true);
            setThinkingLabel(label);
          },
          onDelta: (delta) => {
            setThinking(false);
            setThinkingLabel(undefined);
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: m.content + delta } : m)));
          },
        },
        controller.signal,
      );
      setConversationId(result.conversationId);
      setStatus((s) => (s ? { ...s, usage: result.usage } : s));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Arrêt volontaire : on garde ce qui est déjà affiché, marqué comme interrompu.
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: m.content ? `${m.content}\n\n(Réponse interrompue.)` : "(Réponse interrompue.)" } : m)),
        );
      } else {
        // Échec : on retire la question et la bulle vide, et on rend le texte pour qu'il puisse être renvoyé.
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== replyId));
        setInput(text);
        setError(err instanceof ApiError ? err.message : "L'assistant est momentanément indisponible.");
        if (err instanceof ApiError && err.status === 429) {
          fetchAssistantStatus(accessToken).then(setStatus).catch(() => {});
        }
      }
    } finally {
      setSending(false);
      setThinking(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function openHistory() {
    setError(null);
    setView("history");
    if (!accessToken) return;
    try {
      setHistory(await listAssistantConversations(accessToken));
    } catch {
      setHistory([]);
      setError("Impossible de charger l'historique.");
    }
  }

  async function openConversation(id: number) {
    if (!accessToken) return;
    abortRef.current?.abort();
    try {
      const conv = await getAssistantConversation(accessToken, id);
      setMessages(conv.messages.map((m) => ({ id: nextId(), role: m.role, content: m.content })));
      setConversationId(conv.id);
      setError(null);
      setView("chat");
    } catch {
      setError("Cette conversation est introuvable.");
    }
  }

  async function removeConversation(id: number) {
    if (!accessToken) return;
    if (!window.confirm("Supprimer définitivement cette conversation ?")) return;
    try {
      await deleteAssistantConversation(accessToken, id);
      setHistory((h) => (h ? h.filter((c) => c.id !== id) : h));
      if (id === conversationId) resetConversation();
    } catch {
      setError("Suppression impossible.");
    }
  }

  const closeOnSmallScreen = () => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setOpen(false);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir l'assistant"
          className="fixed bottom-4 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-4 font-label-md text-primary-fg shadow-lg transition-all duration-150 hover:bg-primary-hover active:scale-95 sm:bottom-6 sm:right-6"
        >
          <Sparkles size={18} aria-hidden />
          <span className="hidden sm:inline">Assistant</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Assistant Lyko"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface shadow-lg sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[36rem] sm:max-h-[calc(100vh-3rem)] sm:w-[26rem] sm:rounded-xl sm:border sm:border-border"
        >
          <header className="flex items-center gap-2 border-b border-border bg-primary-bg px-3 py-2.5">
            {view !== "chat" ? (
              <button type="button" onClick={() => setView("chat")} aria-label="Retour à la conversation" className="rounded p-1.5 text-ink-soft hover:bg-surface">
                <ArrowLeft size={18} />
              </button>
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-fg">
                <Sparkles size={16} aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-display text-headline-sm text-ink">{view === "history" ? "Conversations" : view === "profile" ? "Mon profil" : "Assistant Lyko"}</p>
              <p className="text-body-xs text-ink-muted">
                {quotaExhausted ? "Quota mensuel atteint" : `${remaining} message${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""} ce mois-ci`}
              </p>
            </div>
            {view === "chat" && (
              <>
                <button type="button" onClick={resetConversation} aria-label="Nouvelle conversation" title="Nouvelle conversation" className="rounded p-1.5 text-ink-soft hover:bg-surface">
                  <Plus size={18} />
                </button>
                <button type="button" onClick={openHistory} aria-label="Historique" title="Historique" className="rounded p-1.5 text-ink-soft hover:bg-surface">
                  <History size={18} />
                </button>
                <button type="button" onClick={openProfile} aria-label="Mon profil" title="Mon profil" className="rounded p-1.5 text-ink-soft hover:bg-surface">
                  <UserRound size={18} />
                </button>
              </>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer l'assistant" className="rounded p-1.5 text-ink-soft hover:bg-surface">
              <X size={18} />
            </button>
          </header>

          {view === "profile" ? (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <p className="text-body-sm text-ink-soft">
                Ces informations sont mémorisées <strong>jusqu&apos;à ce que vous les effaciez</strong> et transmises à l&apos;assistant pour personnaliser ses réponses.
                Elles ne sont visibles que de vous.
              </p>
              <label className="flex flex-col gap-1 text-body-sm text-ink">
                Comment dois-je vous appeler ?
                <input
                  value={profileName}
                  maxLength={60}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-body-sm text-ink">
                Votre fonction
                <input
                  value={profileTitle}
                  maxLength={80}
                  onChange={(e) => setProfileTitle(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              {error && (
                <p role="alert" className="text-body-sm text-danger-fg">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileName.trim().length < 2 || profileTitle.trim().length < 2}
                  className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-label-md text-primary-fg shadow-sm hover:bg-primary-hover disabled:opacity-50"
                >
                  Enregistrer
                </button>
                {status.profile && (
                  <button type="button" onClick={forgetProfile} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-danger-border bg-danger-bg px-3 font-label-md text-danger-fg hover:border-danger">
                    <Trash2 size={15} /> Oublier mon profil
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {view === "history" ? (
            <div className="flex-1 overflow-y-auto p-3">
              {history === null ? (
                <p className="flex items-center gap-2 p-3 text-body-sm text-ink-muted">
                  <Loader2 size={16} className="animate-spin" /> Chargement…
                </p>
              ) : history.length === 0 ? (
                <p className="p-3 text-body-sm text-ink-muted">Aucune conversation enregistrée.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {history.map((c) => (
                    <li key={c.id} className="flex items-center gap-1 rounded-lg border border-border bg-surface">
                      <button type="button" onClick={() => openConversation(c.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left hover:bg-surface-muted">
                        <span className="block truncate text-body-sm text-ink">{c.title}</span>
                        <span className="block text-body-xs text-ink-muted">{new Date(c.updatedAt).toLocaleDateString("fr-FR")}</span>
                      </button>
                      <button type="button" onClick={() => removeConversation(c.id)} aria-label={`Supprimer « ${c.title} »`} className="mr-1 rounded p-2 text-ink-muted hover:bg-danger-bg hover:text-danger-fg">
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {error && <p className="mt-3 text-body-sm text-danger-fg">{error}</p>}
            </div>
          ) : view === "profile" ? null : (
            <>
              <div className="flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-3">
                    <div className="rounded-lg bg-surface-muted p-3 text-body-sm text-ink-soft">
                      <p className="font-label-md text-ink">
                        {status.profile ? `Bonjour ${status.profile.displayName}, comment puis-je vous aider ?` : "Bonjour, comment puis-je vous aider ?"}
                      </p>
                      <p className="mt-1">
                        Je vous guide dans la plateforme et je réponds à vos questions de gestion locative. Je n&apos;ai pas encore accès aux
                        données de votre entreprise (locataires, loyers, montants).
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          disabled={sending || quotaExhausted}
                          className="rounded-lg border border-primary-border bg-primary-bg px-3 py-2 text-left text-body-sm text-primary transition-colors hover:border-primary disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((m) =>
                      m.role === "user" ? (
                        <div key={m.id} className="ml-8 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-body-sm text-primary-fg">
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        </div>
                      ) : (
                        <div key={m.id} className="mr-6 self-start rounded-2xl rounded-bl-sm bg-surface-muted px-3 py-2">
                          {m.content ? (
                            <SafeMarkdown text={m.content} onNavigate={closeOnSmallScreen} />
                          ) : (
                            <span className="flex items-center gap-2 text-body-sm text-ink-muted">
                              <Loader2 size={14} className="animate-spin" aria-hidden /> {thinkingLabel ?? (thinking ? "Réflexion…" : "…")}
                            </span>
                          )}
                        </div>
                      ),
                    )}
                    {onboarding && (
                      <div className="flex flex-wrap gap-1.5">
                        {(onboarding === "name"
                          ? [status.suggestions?.displayName ?? ""]
                          : [status.suggestions?.jobTitle ?? "", ...TITLE_CHOICES]
                        )
                          .filter((choice, i, all) => choice.trim() !== "" && all.indexOf(choice) === i)
                          .map((choice) => (
                            <button
                              key={choice}
                              type="button"
                              onClick={() => answerIntro(choice)}
                              disabled={sending}
                              className="rounded-full border border-primary-border bg-primary-bg px-3 py-1.5 text-body-sm text-primary transition-colors hover:border-primary disabled:opacity-50"
                            >
                              {choice}
                            </button>
                          ))}
                        <button type="button" onClick={skipIntro} className="rounded-full px-3 py-1.5 text-body-sm text-ink-muted hover:text-ink">
                          Plus tard
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {error && (
                <p role="alert" className="border-t border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {error}
                </p>
              )}

              <form
                className="flex items-end gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <div className="min-w-0 flex-1">
                  <textarea
                    ref={inputRef}
                    value={input}
                    maxLength={MAX_LENGTH}
                    rows={2}
                    disabled={quotaExhausted && !onboarding}
                    placeholder={
                      onboarding === "name" ? "Votre prénom ou nom d'usage…" : onboarding === "title" ? "Votre fonction…" : quotaExhausted ? "Quota mensuel atteint" : "Posez votre question…"
                    }
                    aria-label="Votre message"
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send(input);
                      }
                    }}
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-muted"
                  />
                  {input.length > MAX_LENGTH - 200 && (
                    <p className={cn("mt-0.5 text-right text-body-xs", input.length >= MAX_LENGTH ? "text-danger-fg" : "text-ink-muted")}>
                      {input.length}/{MAX_LENGTH}
                    </p>
                  )}
                </div>
                {sending ? (
                  <button type="button" onClick={stop} aria-label="Arrêter la réponse" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-soft hover:bg-surface-muted">
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim() || (quotaExhausted && !onboarding)}
                    aria-label="Envoyer"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm hover:bg-primary-hover disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                )}
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
