/**
 * WebSocket frame types — mirrors the envelope described in
 * `API_USAGE_GUIDE.md` § Realtime and `docs/realtime_channels.md`.
 */

import type { Uid } from "./common";

/** Channel names known to the Django Channels endpoint. */
export type RealtimeChannel =
  // Existing in API_USAGE_GUIDE.md
  | "tasks"
  | "leads"
  | "lead-statuses"
  | "notices"
  | "invoice-plans"
  | "invoice-entries"
  // Added in docs/realtime_channels.md
  | "chat-messages"
  | "chat-members"
  | "attendance"
  | "work-logs"
  | "work-plans"
  | "employees"
  | "employee-salary"
  | "masters"
  | "orgs"
  | "holidays"
  | "app-settings"
  | "pace-goals"
  | "pace-goal-reviews"
  | "pace-meetings"
  | "pace-checklist"
  | "client-classifications"
  | "lead-history"
  | "growth-plans";

/** Server-to-client event type. */
export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "ERROR" | "PING";

/** Server-to-client frame delivering a change. */
export interface RealtimeMessage<TRecord = unknown> {
  readonly channel: RealtimeChannel;
  readonly event: RealtimeEvent;
  readonly record?: TRecord;
  readonly error?: string;
}

/** Optional filter object on a subscribe frame. */
export interface RealtimeFilter {
  readonly room_uid?: Uid;
  readonly user_uid?: Uid;
  readonly goal_uid?: Uid;
  readonly lead_uid?: Uid;
  readonly org_uid?: Uid;
  readonly fy?: string;
}

/** Client-to-server subscribe frame. */
export interface RealtimeSubscribeFrame {
  readonly action: "subscribe";
  readonly channel: RealtimeChannel;
  readonly filter?: RealtimeFilter;
}

/** Client-to-server unsubscribe frame. */
export interface RealtimeUnsubscribeFrame {
  readonly action: "unsubscribe";
  readonly channel: RealtimeChannel;
}

/** Union of all client-to-server frames. */
export type RealtimeClientFrame =
  | RealtimeSubscribeFrame
  | RealtimeUnsubscribeFrame;
