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
    </>
  );
}
