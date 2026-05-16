import { useEffect, useState } from "react";
import {
  getGcalStatus,
  getGcalAuthUrl,
  disconnectGcal,
} from "@/lib/api/gcal";
import type { GcalStatusDto } from "@/types/api/gcal";

type View =
  | { kind: "loading" }
  | { kind: "anon" }
  | {
      kind: "connected";
      email: string;
      scopes: readonly string[];
      connectedAt: string;
    }
  | { kind: "error"; message: string };

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function GoogleCalendarCard() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setView({ kind: "loading" });
    try {
      const s: GcalStatusDto = await getGcalStatus();
      if (s.connected) {
        setView({
          kind: "connected",
          email: s.google_email,
          scopes: s.scopes,
          connectedAt: s.connected_at,
        });
      } else {
        setView({ kind: "anon" });
      }
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load status",
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onConnect = async () => {
    setBusy(true);
    try {
      const { url } = await getGcalAuthUrl();
      window.location.href = url;
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't start sign-in",
      });
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm("Disconnect Google Calendar from Tasktracker?")) return;
    setBusy(true);
    try {
      await disconnectGcal();
      await refresh();
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Disconnect failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 18,
        background: "#fff",
        maxWidth: 540,
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
        Google Calendar
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#475569" }}>
        Connect your Google account to overlay calendar events on Tasktracker
        and schedule meetings from tasks.
      </p>

      {view.kind === "loading" && (
        <div style={{ fontSize: 13, color: "#64748b" }}>Loading…</div>
      )}

      {view.kind === "anon" && (
        <button
          type="button"
          disabled={busy}
          onClick={onConnect}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 6,
            background: "#2563eb",
            color: "#fff",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Connect Google Calendar
        </button>
      )}

      {view.kind === "connected" && (
        <div style={{ fontSize: 13, color: "#1e293b" }}>
          <div>
            Connected as <strong>{view.email}</strong>
          </div>
          <div style={{ marginTop: 4, color: "#64748b" }}>
            Scopes: {view.scopes.join(", ") || "(none)"}
          </div>
          <div style={{ marginTop: 4, color: "#64748b" }}>
            Since {fmtDate(view.connectedAt)}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onDisconnect}
            style={{
              marginTop: 12,
              padding: "6px 12px",
              border: "1px solid #fca5a5",
              borderRadius: 6,
              background: "#fee2e2",
              color: "#dc2626",
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {view.kind === "error" && (
        <div style={{ color: "#dc2626", fontSize: 13 }}>{view.message}</div>
      )}
    </div>
  );
}
