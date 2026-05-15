import { useState } from "react";
import type { Profile } from "@/types/auth";
import { useMyTodayStandup } from "@/hooks/useMyTodayStandup";

interface FloatingDayPriorityProps {
  profile: Profile | null;
  onNavigateToPace: () => void;
}

type DotStatus = "none" | "pending" | "approved";

function statusToDot(status: "Pending" | "Approved" | undefined): DotStatus {
  if (status === "Approved") return "approved";
  if (status === "Pending") return "pending";
  return "none";
}

const DOT_COLORS: Record<DotStatus, string> = {
  approved: "#16a34a",
  pending: "#d97706",
  none: "#94a3b8",
};

export default function FloatingDayPriority({
  profile,
  onNavigateToPace: _onNavigateToPace,
}: FloatingDayPriorityProps) {
  const [open, setOpen] = useState(false);
  const { entry } = useMyTodayStandup(profile?.id ?? null);

  if (!profile) return null;

  const dot = statusToDot(entry?.status);

  return (
    <>
      <button
        type="button"
        title="My priorities today"
        aria-label="My priorities today"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          bottom: 148,
          right: 24,
          zIndex: 9001,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: open ? "#1d4ed8" : "#2563eb",
          color: "#fff",
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(37,99,235,.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s,transform .15s",
          transform: open ? "scale(1.05)" : "scale(1)",
        }}
      >
        📋
        <span
          data-testid="day-priority-status-dot"
          data-status={dot}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: DOT_COLORS[dot],
            border: "2px solid #fff",
          }}
        />
      </button>

      {open && (
        <div
          data-testid="day-priority-panel"
          role="dialog"
          aria-label="My priorities today"
          style={{
            position: "fixed",
            right: 24,
            bottom: 200,
            width: 320,
            minWidth: 260,
            minHeight: 180,
            maxWidth: 600,
            maxHeight: "80vh",
            zIndex: 9000,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            resize: "both",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid #e2e8f0",
              cursor: "move",
              userSelect: "none",
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              gap: 8,
            }}
          >
            <span>📋 My Priorities</span>
            <span style={{ marginLeft: "auto", fontWeight: 500, fontSize: 12, color: "#64748b" }}>
              {/* date filled in Task 4 */}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 16,
                color: "#64748b",
                padding: 0,
                marginLeft: 8,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: 12, flex: 1 }}>{/* body filled in Tasks 4–5 */}</div>
        </div>
      )}
    </>
  );
}
