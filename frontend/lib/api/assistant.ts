import { API_URL, ApiError, apiFetch } from "./client";

export type AssistantUsage = { used: number; quota: number; remaining: number };
export type AssistantBlockReason = "disabled" | "not_permitted" | "not_configured";
export type AssistantProfile = { displayName: string; jobTitle: string };
export type AssistantStatus = {
  available: boolean;
  reason: AssistantBlockReason | null;
  usage: AssistantUsage;
  /** Nom d'usage + fonction mémorisés (null = jamais renseignés : le panneau propose de faire connaissance). */
  profile?: AssistantProfile | null;
  /** De quoi pré-remplir : prénom du compte et titre du poste. */
  suggestions?: AssistantProfile;
};

export type AssistantSettings = {
  enabled: boolean;
  consentAt: string | null;
  keyConfigured: boolean;
  model: string;
  retentionDays: number;
  usage: AssistantUsage & { inputTokens: number; outputTokens: number; cacheReadTokens: number };
};

export type AssistantMessage = { id: number; role: "user" | "assistant"; content: string; createdAt: string };
export type AssistantConversationSummary = { id: number; title: string; createdAt: string; updatedAt: string };
export type AssistantConversation = AssistantConversationSummary & { messages: AssistantMessage[] };

const json = { "Content-Type": "application/json" };

export function fetchAssistantStatus(accessToken: string) {
  return apiFetch<AssistantStatus>("/api/assistant/status", { accessToken });
}

export function fetchAssistantSettings(accessToken: string) {
  return apiFetch<AssistantSettings>("/api/assistant/settings", { accessToken });
}

export function saveAssistantSettings(
  accessToken: string,
  input: { enabled: boolean; acknowledge?: boolean },
) {
  return apiFetch<{ enabled: boolean; consentAt: string | null; usage: AssistantSettings["usage"] }>("/api/assistant/settings", {
    method: "PUT",
    accessToken,
    headers: json,
    body: JSON.stringify(input),
  });
}

export async function saveAssistantProfile(accessToken: string, input: AssistantProfile) {
  const res = await apiFetch<{ profile: AssistantProfile }>("/api/assistant/profile", {
    method: "PUT",
    accessToken,
    headers: json,
    body: JSON.stringify(input),
  });
  return res.profile;
}

export function deleteAssistantProfile(accessToken: string) {
  return apiFetch<void>("/api/assistant/profile", { method: "DELETE", accessToken });
}

export async function listAssistantConversations(accessToken: string) {
  const res = await apiFetch<{ conversations: AssistantConversationSummary[] }>("/api/assistant/conversations", { accessToken });
  return res.conversations;
}

export async function getAssistantConversation(accessToken: string, id: number) {
  const res = await apiFetch<{ conversation: AssistantConversation }>(`/api/assistant/conversations/${id}`, { accessToken });
  return res.conversation;
}

export function deleteAssistantConversation(accessToken: string, id: number) {
  return apiFetch<void>(`/api/assistant/conversations/${id}`, { method: "DELETE", accessToken });
}

export type ChatHandlers = {
  onDelta: (text: string) => void;
  /** Signal d'activité pendant que l'assistant travaille — `label` précise ce qu'il fait (ex. consultation
   * d'un outil), absent pour une simple réflexion générique. */
  onThinking?: (label?: string) => void;
};

/**
 * Un tour de conversation en flux continu (Server-Sent Events). `fetch` et non `EventSource` : il faut
 * envoyer un corps JSON et l'en-tête Authorization. Résout avec l'identifiant de la conversation ;
 * rejette avec `ApiError` (droits, quota, service indisponible) — un abandon volontaire (`signal`) rejette
 * avec `AbortError`.
 */
export async function streamAssistantChat(
  accessToken: string,
  input: { message: string; conversationId?: number },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<{ conversationId: number; usage: AssistantUsage }> {
  const res = await fetch(`${API_URL}/api/assistant/chat`, {
    method: "POST",
    credentials: "include",
    signal,
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });

  // Refus AVANT le flux (droits, quota, validation) : une vraie erreur HTTP en JSON.
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error || `Erreur ${res.status}`, body?.details);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: { conversationId: number; usage: AssistantUsage } | null = null;

  const handleBlock = (block: string) => {
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) return; // commentaire de battement (": ping")
    const event = JSON.parse(dataLine.slice(6)) as
      | { type: "delta"; text: string }
      | { type: "status"; status: "thinking" | "tool"; label?: string }
      | { type: "done"; conversationId: number; usage: AssistantUsage }
      | { type: "error"; message: string; status?: number };
    if (event.type === "delta") handlers.onDelta(event.text);
    else if (event.type === "status") handlers.onThinking?.(event.status === "tool" ? event.label : undefined);
    else if (event.type === "done") done = { conversationId: event.conversationId, usage: event.usage };
    else if (event.type === "error") throw new ApiError(event.status ?? 500, event.message);
  };

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleBlock(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) handleBlock(buffer);

  if (!done) throw new ApiError(502, "La réponse de l'assistant a été interrompue.");
  return done;
}
