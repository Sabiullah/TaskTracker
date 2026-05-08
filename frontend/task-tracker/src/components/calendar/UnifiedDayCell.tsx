import type { ReactNode } from "react";
import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import { toMins, fromMins } from "@/utils/time";
import type { Task, WorkPlan } from "@/types";

interface UnifiedDayCellProps {
  dayNumber: number;
  isToday: boolean;
  isWeekend: boolean;
  tasks: Task[]; // already sorted by status
  plans: WorkPlan[]; // already sorted by date (within day, source order)
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  onClick: () => void;
}

const SECTION_LIMIT = 2;

export default function UnifiedDayCell({
  dayNumber,
  isToday,
  isWeekend,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  onClick,
}: UnifiedDayCellProps) {
  const hasTasks = showTasks && tasks.length > 0;
  const hasPlans = showPlans && plans.length > 0;
  const hasAny = hasTasks || hasPlans;

  const visibleTasks = showTasks ? tasks.slice(0, SECTION_LIMIT) : [];
  const taskExtra = showTasks ? Math.max(0, tasks.length - SECTION_LIMIT) : 0;

  const visiblePlans = showPlans ? plans.slice(0, SECTION_LIMIT) : [];
  const planExtra = showPlans ? Math.max(0, plans.length - SECTION_LIMIT) : 0;

  const totalPlanMins = plans.reduce(
    (s, p) => s + toMins(p.hours_planned),
    0,
  );

  // Top-right badge: plans on → planned-hours; plans off → task-count.
  let badge: ReactNode = null;
  if (showPlans && plans.length > 0) {
    badge = (
      <span
        style={{
          fontSize: 9,
          color: "#0f766e",
          fontWeight: 700,
          background: "#ccfbf1",
          borderRadius: 3,
          padding: "1px 4px",
          lineHeight: 1.4,
        }}
        title={`${fromMins(totalPlanMins)} planned · ${plans.length} plan${plans.length !== 1 ? "s" : ""}`}
      >
        {fromMins(totalPlanMins)}
      </span>
    );
  } else if (showTasks && tasks.length > 0) {
    badge = (
      <span
        style={{
          fontSize: 9,
          color: "#2563eb",
          fontWeight: 700,
          background: "#eff6ff",
          borderRadius: 3,
          padding: "1px 4px",
          lineHeight: 1.4,
        }}
      >
        {tasks.length} ⤢
      </span>
    );
  }

  return (
    <div
      onClick={hasAny ? onClick : undefined}
      style={{
        minHeight: showPlans ? 130 : 90,
        padding: 4,
        borderRight: "1px solid #f1f5f9",
        borderBottom: "1px solid #f1f5f9",
        background: isToday ? "#eff6ff" : isWeekend ? "#fafafa" : "white",
        cursor: hasAny ? "pointer" : "default",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 2,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: isToday ? "#2563eb" : "transparent",
            color: isToday ? "#fff" : isWeekend ? "#ef4444" : "#374151",
            fontSize: 12,
            fontWeight: isToday ? 700 : 500,
            textAlign: "center",
            lineHeight: "22px",
          }}
        >
          {dayNumber}
        </span>
        {badge}
      </div>

      {/* Tasks section */}
      {showTasks && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visibleTasks.map((t, i) => {
            const col = COLUMNS.find((c) => c.id === t.status);
            const isRec = t.recurrence && t.recurrence !== "Onetime";
            return (
              <div
                key={t.id + "-t-" + i}
                title={`${t.description} — ${t.responsible}${isRec ? " (⟳ " + t.recurrence + ")" : ""}\nStatus: ${t.status}`}
                style={{
                  background: col?.color || "#888",
                  color: "#fff",
                  borderRadius: 3,
                  fontSize: 10,
                  padding: "1px 4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {isRec ? "⟳ " : ""}
                {(t.description || "").slice(0, 16)}
                {(t.description || "").length > 16 ? "…" : ""}
              </div>
            );
          })}
          {taskExtra > 0 && (
            <div
              style={{
                fontSize: 10,
                color: "#2563eb",
                fontWeight: 600,
                padding: "1px 0",
              }}
            >
              +{taskExtra} more
            </div>
          )}
        </div>
      )}

      {/* Divider only if BOTH sections have content */}
      {showTasks && tasks.length > 0 && showPlans && plans.length > 0 && (
        <div
          style={{
            borderTop: "1px dashed #e2e8f0",
            margin: "4px 0 3px",
          }}
        />
      )}

      {/* Plans section */}
      {showPlans && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visiblePlans.map((p, i) => {
            const c = empColorMap[p.name] || EMP_COLORS[0];
            const initials = (p.name || "?")
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const label = p.client || p.task_description || p.name;
            return (
              <div
                key={p.id + "-p-" + i}
                title={`${p.name}${p.client ? " → " + p.client : ""}\n${p.task_description || ""}${p.hours_planned ? " (" + p.hours_planned + "hrs)" : ""}`}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1px solid ${c.dot}`,
                  borderRadius: 4,
                  padding: "2px 5px",
                  fontSize: 10,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: c.dot,
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
          {planExtra > 0 && (
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                fontWeight: 600,
                paddingLeft: 2,
              }}
            >
              +{planExtra} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
