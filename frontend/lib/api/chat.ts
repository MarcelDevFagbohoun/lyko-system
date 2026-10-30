import { apiFetch, API_URL, ApiError } from "./client";

// Discussion interne un-à-un (migration 132, routes/chat.js).

export type ChatAttachment = { name: string; mime: string; size: number; isImage: boolean; url: string };

export type ChatMessage = {
  id: number;
  senderId: number;
  mine: boolean;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  attachment: ChatAttachment | null;
};

export type ChatContact = {
  userId: number;
  name: string;
  role: "dg" | "comptable" | "agent";
  roleLabel: string;
  avatarUrl: string | null;
  last: { preview: string; mine: boolean; at: string; deleted: boolean; read: boolean } | null;
  unread: number;
};

export type ChatThread = {
  peer: { userId: number; name: string; roleLabel: string; avatarUrl: string | null };
  messages: ChatMessage[];
  peerLastReadId: number;
  hasMore: boolean;
};

const auth = (accessToken: string) => ({ accessToken });
const json = { "Content-Type": "application/json" };

export const chatConversations = (accessToken: string) =>
  apiFetch<{ conversations: ChatContact[]; unreadTotal: number }>("/api/chat/conversations", auth(accessToken));

export const chatUnreadCount = (accessToken: string) =>
  apiFetch<{ count: number }>("/api/chat/unread-count", auth(accessToken));

export const chatThread = (accessToken: string, peerId: number, opts: { before?: number; markRead?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.before) q.set("before", String(opts.before));
  if (opts.markRead === false) q.set("markRead", "false");
  const qs = q.toString();
  return apiFetch<ChatThread>(`/api/chat/conversations/${peerId}/messages${qs ? `?${qs}` : ""}`, auth(accessToken));
};

export async function chatSend(accessToken: string, peerId: number, body: string, file?: File | null) {
  const fd = new FormData();
  if (body) fd.append("body", body);
  if (file) fd.append("file", file);
  const r = await apiFetch<{ message: ChatMessage }>(`/api/chat/conversations/${peerId}/messages`, { ...auth(accessToken), method: "POST", body: fd });
  return r.message;
}

export const chatEdit = (accessToken: string, id: number, body: string) =>
  apiFetch<{ message: ChatMessage }>(`/api/chat/messages/${id}`, { ...auth(accessToken), method: "PATCH", headers: json, body: JSON.stringify({ body }) }).then((r) => r.message);

export const chatDelete = (accessToken: string, id: number) =>
  apiFetch<void>(`/api/chat/messages/${id}`, { ...auth(accessToken), method: "DELETE" });

/** Télécharge / ouvre une pièce jointe (protégée par jeton, donc via blob). */
export async function chatOpenAttachment(accessToken: string, a: ChatAttachment, download: boolean) {
  const res = await fetch(`${API_URL}${a.url}${download ? "?download=1" : ""}`, { credentials: "include", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new ApiError(res.status, "Fichier introuvable");
  const url = URL.createObjectURL(await res.blob());
  if (download) {
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
