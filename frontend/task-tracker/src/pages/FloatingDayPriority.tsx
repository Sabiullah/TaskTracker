import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Profile } from "@/types/auth";
import type { OperationalStandupDto } from "@/types/api";
import { useMyTodayStandup } from "@/hooks/useMyTodayStandup";
import { loadLS, saveLS } from "@/utils/storage";

interface FloatingDayPriorityProps {
  profile: Profile | null;
  onNavigateToPace: () => void;
}

type DotStatus = "none" | "pending" | "approved";

// Collapse the per-org approval matrix to a single "headline" status for the
// floating widget: Approved only if every org has approved; else Pending if the
// row exists; else none.
function entryStatus(entry: OperationalStandupDto | null): "Approved" | "Pending" | undefined {
  if (!entry) return undefined;
  // Defensive: test fixtures and pre-migration cached entries may omit the
  // approvals array — treat that as "submitted but unknown" (= Pending).
  const approvals = entry.approvals ?? [];
  if (approvals.length > 0 && approvals.every((a) => a.status === "Approved"))
    return "Approved";
  return "Pending";
}

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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatToday(): string {
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const BADGE_STYLES: Record<"approved" | "pending", { bg: string; fg: string; label: string }> = {
  approved: { bg: "#dcfce7", fg: "#15803d", label: "Approved" },
  pending:  { bg: "#fef3c7", fg: "#b45309", label: "Pending"  },
};

interface SavedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

function lsKey(userId: string): string {
  return `day_priority_panel_${userId}`;
}

function fitsViewport(s: SavedLayout): boolean {
  if (typeof window === "undefined") return true;
  if (s.width < 260 || s.height < 180) return false;
  if (s.x < 0 || s.y < 0) return false;
  if (s.x > window.innerWidth - 100) return false;
  if (s.y > window.innerHeight - 100) return false;
  return true;
}

export default function FloatingDayPriority({
  profile,
  onNavigateToPace,
}: FloatingDayPriorityProps) {
  const [open, setOpen] = useState(false);
  const { entry } = useMyTodayStandup(profile?.id ?? null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    if (!profile?.id) return null;
    const saved = loadLS<SavedLayout | null>(lsKey(profile.id), null);
    return saved && fitsViewport(saved) ? { x: saved.x, y: saved.y } : null;
  });
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    if (!profile?.id) return { width: 320, height: 220 };
    const saved = loadLS<SavedLayout | null>(lsKey(profile.id), null);
    return saved && fitsViewport(saved)
      ? { width: saved.width, height: saved.height }
      : { width: 320, height: 220 };
  });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);
  const dragListenersRef = useRef<{ move: (ev: MouseEvent) => void; up: () => void } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return; // don't drag from ✕
    const rect = panelRef.current?.getBoundingClientRect();
    const baseX = pos?.x ?? rect?.left ?? 0;
    const baseY = pos?.y ?? rect?.top ?? 0;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX, baseY };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const minWidth = 260;
      const minHeight = 180;
      const maxX = Math.max(0, window.innerWidth - Math.max(sizeRef.current.width, minWidth));
      const maxY = Math.max(0, window.innerHeight - Math.max(sizeRef.current.height, minHeight));
      const x = Math.min(maxX, Math.max(0, d.baseX + (ev.clientX - d.startX)));
      const y = Math.min(maxY, Math.max(0, d.baseY + (ev.clientY - d.startY)));
      setPos({ x, y });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      dragListenersRef.current = null;
    };
    dragListenersRef.current = { move: onMove, up: onUp };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        document.removeEventListener("mousemove", dragListenersRef.current.move);
        document.removeEventListener("mouseup", dragListenersRef.current.up);
        dragListenersRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const isTest = import.meta.env.MODE === "test";
    // Test-only hook so we can fire synthetic resize events in jsdom (no real RO).
    // Tree-shaken out of production builds via the MODE check.
    if (isTest && typeof window !== "undefined") {
      (window as unknown as { __dayPriorityFireResize?: (w: number, h: number) => void })
        .__dayPriorityFireResize = (w, h) => flushSync(() => setSize({ width: w, height: h }));
    }
    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (isTest && typeof window !== "undefined") {
          delete (window as unknown as { __dayPriorityFireResize?: unknown }).__dayPriorityFireResize;
        }
      };
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (isTest && typeof window !== "undefined") {
        delete (window as unknown as { __dayPriorityFireResize?: unknown }).__dayPriorityFireResize;
      }
    };
  }, [open]);

  useEffect(() => {
    if (!profile?.id || !pos) return;
    saveLS<SavedLayout>(lsKey(profile.id), {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    });
    // Depend on size scalars (not the object) so identical-value resize ticks
    // from ResizeObserver don't re-write the same payload to localStorage.
  }, [pos, size.width, size.height, profile?.id]);

  if (!profile) return null;

  const headlineStatus = entryStatus(entry);
  const dot = statusToDot(headlineStatus);

  return (
    <>
      <button
        ref={buttonRef}
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
          ref={panelRef}
          data-testid="day-priority-panel"
          role="dialog"
          aria-label="My priorities today"
          style={{
            position: "fixed",
            left: pos ? `${pos.x}px` : "auto",
            top: pos ? `${pos.y}px` : "auto",
            right: pos ? "auto" : "24px",
            bottom: pos ? "auto" : "200px",
            width: size.width,
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
            overflow: "hidden",
            resize: "both",
          }}
        >
          <div
            data-testid="day-priority-header"
            onMouseDown={onHeaderMouseDown}
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
            <span data-testid="day-priority-date" style={{ marginLeft: "auto", fontWeight: 500, fontSize: 12, color: "#64748b" }}>
              {formatToday()}
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
          <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            {entry && headlineStatus && (
              <span
                data-testid="day-priority-badge"
                data-status={headlineStatus === "Approved" ? "approved" : "pending"}
                style={{
                  alignSelf: "flex-start",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: BADGE_STYLES[headlineStatus === "Approved" ? "approved" : "pending"].bg,
                  color: BADGE_STYLES[headlineStatus === "Approved" ? "approved" : "pending"].fg,
                }}
              >
                {BADGE_STYLES[headlineStatus === "Approved" ? "approved" : "pending"].label}
              </span>
            )}
            {entry && entry.priorities.trim() ? (
              <div
                data-testid="day-priority-body"
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  color: "#0f172a",
                  lineHeight: 1.5,
                  overflowY: "auto",
                  flex: 1,
                }}
              >
                {entry.priorities}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "#64748b",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                <div>No priorities submitted for today yet.</div>
                <button
                  type="button"
                  onClick={() => {
                    onNavigateToPace();
                    setOpen(false);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#2563eb",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: 0,
                  }}
                >
                  Go to Daily Standup →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
