import { apiFetch } from "./client";
import type { ComplaintCategory, ComplaintPriority, ComplaintStatus } from "./complaints";

/** Page de suivi publique d'une plainte : le jeton du lien est le seul secret, aucun accessToken. */

export type TrackingEvent = {
  id: number;
  type: "reported" | "status_changed" | "comment";
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  body: string | null;
  isEstimated: boolean;
  createdAt: string;
  /** Jamais le nom d'un employé : "team" ou "tenant". */
  by: "team" | "tenant";
};

export type TrackingView = {
  complaint: {
    code: string;
    title: string;
    category: ComplaintCategory;
    priority: ComplaintPriority;
    status: ComplaintStatus;
    description: string | null;
    property: string | null;
    unit: string | null;
    canComment: boolean;
  };
  company: { name: string; phone: string | null };
  dates: { reportedAt: string; lastActivityAt: string; resolvedAt: string | null };
  events: TrackingEvent[];
  teamLabel: string;
};

export function getComplaintTracking(token: string) {
  return apiFetch<TrackingView>(`/api/complaint-tracking/${encodeURIComponent(token)}`);
}

export function sendTrackingComment(token: string, message: string) {
  return apiFetch<TrackingView>(`/api/complaint-tracking/${encodeURIComponent(token)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}
