import type {
  RealtimeChannel,
  RealtimeClientFrame,
  RealtimeFilter,
  RealtimeMessage,
} from "@/types/api";
import { getAccessToken } from "./client";

/**
 * Default WS URL is derived from `window.location` so the build is
 * host-agnostic: the SPA running on https://example.com/ opens
 * wss://example.com/ws/ automatically; IP-mode on http://1.2.3.4:8000/
 * opens ws://1.2.3.4:8000/ws/. Override via VITE_WS_URL only if the
 * WebSocket lives on a different origin.
 */
function defaultWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8000/ws/";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/`;
}

const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? defaultWsUrl();

type SubscriptionId = number;
export type RealtimeHandler<TRecord = unknown> = (
  msg: RealtimeMessage<TRecord>,
) => void;

interface Subscription {
  readonly id: SubscriptionId;
  readonly channel: RealtimeChannel;
  readonly filter?: RealtimeFilter;
  readonly handler: RealtimeHandler;
}

// Grace period before closing an idle socket, so React StrictMode's
// mount → cleanup → remount cycle doesn't close a still-CONNECTING socket.
const IDLE_CLOSE_DELAY_MS = 500;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private readonly subs = new Map<SubscriptionId, Subscription>();
  private nextId: SubscriptionId = 1;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  private connect(): void {
    if (this.socket) return;
    if (typeof WebSocket === "undefined") return;

    this.explicitlyClosed = false;
    const token = getAccessToken();
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      // Re-send every active subscription on (re)connect.
      for (const sub of this.subs.values()) {
        this.sendSubscribe(sub);
      }
    });

    socket.addEventListener("message", (ev: MessageEvent) => {
      let payload: RealtimeMessage | null = null;
      try {
        payload = JSON.parse(String(ev.data)) as RealtimeMessage;
      } catch {
        return;
      }
      if (!payload || !payload.channel) return;
      if (payload.event === "PING") return; // heartbeat
      for (const sub of this.subs.values()) {
        if (sub.channel === payload.channel) sub.handler(payload);
      }
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.explicitlyClosed) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // Exponential backoff capped at 30 s.
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subs.size > 0) this.connect();
    }, delay);
  }

  private send(frame: RealtimeClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private sendSubscribe(sub: Subscription): void {
    this.send({
      action: "subscribe",
      channel: sub.channel,
      filter: sub.filter,
    });
  }

  /**
   * Subscribe to a Django Channels topic. Returns an `unsubscribe` function.
   * The socket opens lazily on first subscribe and closes when the last
   * subscription is removed.
   */
  subscribe<TRecord = unknown>(
    channel: RealtimeChannel,
    handler: RealtimeHandler<TRecord>,
    filter?: RealtimeFilter,
  ): () => void {
    // Re-subscribing cancels any pending idle-close so we reuse the socket.
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }

    const id = this.nextId++;
    const sub: Subscription = {
      id,
      channel,
      filter,
      handler: handler as RealtimeHandler,
    };
    this.subs.set(id, sub);

    if (!this.socket) this.connect();
    else if (this.socket.readyState === WebSocket.OPEN) this.sendSubscribe(sub);

    return () => this.unsubscribe(id);
  }

  private unsubscribe(id: SubscriptionId): void {
    const sub = this.subs.get(id);
    if (!sub) return;
    this.subs.delete(id);

    // Only emit an unsubscribe frame if no other subscription is using the same channel.
    const stillUsed = [...this.subs.values()].some(
      (s) => s.channel === sub.channel,
    );
    if (!stillUsed) {
      this.send({ action: "unsubscribe", channel: sub.channel });
    }

    if (this.subs.size === 0) {
      // Delay the actual close — React StrictMode remounts immediately
      // after cleanup, and closing a CONNECTING socket causes
      // "closed before the connection is established".
      if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = setTimeout(() => {
        this.idleCloseTimer = null;
        if (this.subs.size === 0) this.close();
      }, IDLE_CLOSE_DELAY_MS);
    }
  }

  close(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* already closing */
      }
      this.socket = null;
    }
  }
}

export const ws = new WebSocketClient();
export { WS_URL };
