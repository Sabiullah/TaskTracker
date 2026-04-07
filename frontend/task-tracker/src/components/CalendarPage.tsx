import { useState } from "react";
import { COLUMNS } from "@/constants";
import {
  hasRecurringInstance,
  getProjectedDate,
  computeStatus,
} from "@/lib/taskUtils";
import type { Task } from "@/types/task";
import type { Profile } from "@/types/auth";
import type { CalendarPageProps } from "@/types/components";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const navBtn = {
  padding: "6px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#f8fafc",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

export default function CalendarPage({
  tasks,
  profile,
  profiles,
}: CalendarPageProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [expandDay, setExpandDay] = useState<number | null>(null); // day number or null

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const myName = profile?.full_name || profile?.name || "";

  // Hierarchy visibility
  let visible: Task[] = tasks;
  if (!isAdmin && !isManager) {
    visible = tasks.filter((t: Task) => t.responsible === myName);
  } else if (isManager) {
    const managedNames = profiles
      .filter((p: Profile) => {
        const managerIds = Array.isArray(p.manager_ids)
          ? p.manager_ids
          : p.manager_id
            ? [p.manager_id]
            : [];
        return managerIds.includes(profile?.id);
      })
      .map((p: Profile) => p.full_name || "");
    visible = tasks.filter(
      (t: Task) =>
        t.responsible === myName || managedNames.includes(t.responsible),
    );
  }

  // Build monthTasks: place each task on its date in this calendar month.
  // For recurring tasks: project the date but KEEP original status
  // (so completed tasks stay green, etc. — no false Overdue for past dates)
  const monthTasks: Task[] = [];
  const unscheduled: Task[] = [];

  visible.forEach((t: Task) => {
    const r = t.recurrence || "Onetime";
    if (!t.target_date) {
      unscheduled.push(t);
      return;
    }
    if (r === "Onetime") {
      const taskMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
      if (t.target_date.startsWith(taskMonth)) monthTasks.push(t);
    } else {
      if (hasRecurringInstance(t, year, month)) {
        const projectedDate = getProjectedDate(t, year, month);
        // If this is a different cycle than the original task month,
        // clear expectedDate, compDate, remarks — they belong to the original cycle only.
        const origMonth = (t.target_date || "").slice(0, 7);
        const calMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
        const isDiffCycle = origMonth !== calMonth;
        // Build projected task with cleared fields for new cycles
        const projectedTask = {
          ...t,
          target_date: projectedDate,
          ...(isDiffCycle
            ? { expected_date: "", comp_date: "", remarks: "" }
            : {}),
        };
        // Always recompute status from projected date + cleared fields
        // so stale statuses don't bleed from previous cycles
        const taskStatus = computeStatus(projectedTask);
        monthTasks.push({ ...projectedTask, status: taskStatus });
      }
    }
  });

  // Group by day number — Overdue tasks always first
  const STATUS_ORDER: Record<string, number> = {
    Overdue: 0,
    TodayTask: 1,
    Tomorrow: 2,
    Pending: 3,
    TBC: 4,
    Ontime: 5,
    "Completed Delay": 6,
    Completed: 7,
    "Future Task/Goals": 8,
  };
  const byDay: Record<number, Task[]> = {};
  monthTasks.forEach((t: Task) => {
    const d = parseInt(t.target_date.split("-")[2]);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(t);
  });
  // Sort each day: Overdue first, then by status order
  Object.keys(byDay).forEach((d) => {
    byDay[parseInt(d)].sort(
      (a: Task, b: Task) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );
  });

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOff = (firstDay.getDay() + 6) % 7;

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  // Tasks shown in the expand modal (already sorted — Overdue first)
  const expandTasks = expandDay ? byDay[expandDay] || [] : [];
  const expandDateStr = expandDay
    ? `${expandDay} ${MONTHS[month]} ${year}`
    : "";

  return (
    <div style={{ padding: "16px 20px" }}>
      {/* Navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <button onClick={prevMonth} style={navBtn}>
          ‹ Prev
        </button>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            minWidth: 180,
            textAlign: "center",
          }}
        >
          {MONTHS[month]} {year}
        </span>
        <button onClick={nextMonth} style={navBtn}>
          Next ›
        </button>
        <button
          onClick={goToday}
          style={{ ...navBtn, fontSize: 12, marginLeft: 4 }}
        >
          Today
        </button>
      </div>

      {/* Legend */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}
      >
        {COLUMNS.map((c) => (
          <span
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "#475569",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: c.color,
                display: "inline-block",
              }}
            />
            {c.title}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
          ⟳ = Recurring
        </span>
      </div>

      {/* Calendar grid */}
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          overflow: "hidden",
        }}
      >
        {/* Day headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#f8fafc",
          }}
        >
          {DAYS.map((d) => (
            <div
              key={d}
              style={{
                padding: "8px 4px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {/* Empty offset cells */}
          {Array.from({ length: startOff }).map((_, i) => (
            <div
              key={`e${i}`}
              style={{
                minHeight: 90,
                borderRight: "1px solid #f1f5f9",
                borderBottom: "1px solid #f1f5f9",
                background: "#fafafa",
              }}
            />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isToday = ds === todayStr;
            const dt = byDay[d] || [];
            const visible3 = dt.slice(0, 3);
            const extra = dt.length - 3;

            return (
              <div
                key={d}
                style={{
                  minHeight: 90,
                  padding: 4,
                  borderRight: "1px solid #f1f5f9",
                  borderBottom: "1px solid #f1f5f9",
                  background: isToday ? "#eff6ff" : "white",
                }}
              >
                {/* Date number */}
                <span
                  style={{
                    display: "inline-block",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isToday ? "#2563eb" : "transparent",
                    color: isToday ? "#fff" : "#374151",
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 500,
                    textAlign: "center",
                    lineHeight: "22px",
                    marginBottom: 2,
                  }}
                >
                  {d}
                </span>

                {/* Task chips */}
                {visible3.map((t: Task, i: number) => {
                  const col = COLUMNS.find((c) => c.id === t.status);
                  const isRec = t.recurrence && t.recurrence !== "Onetime";
                  return (
                    <div
                      key={t.id + "-" + i}
                      title={`${t.description} — ${t.responsible}${isRec ? " (⟳ " + t.recurrence + ")" : ""}\nStatus: ${t.status}`}
                      style={{
                        background: col?.color || "#888",
                        color: "#fff",
                        borderRadius: 3,
                        fontSize: 10,
                        padding: "1px 4px",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "default",
                      }}
                    >
                      {isRec ? "⟳ " : ""}
                      {(t.description || "").slice(0, 16)}
                      {(t.description || "").length > 16 ? "…" : ""}
                    </div>
                  );
                })}

                {/* "+N more" expand button */}
                {extra > 0 && (
                  <button
                    onClick={() => setExpandDay(d)}
                    style={{
                      fontSize: 10,
                      color: "#2563eb",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "1px 0",
                      fontWeight: 600,
                    }}
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled tasks */}
      {unscheduled.length > 0 && (
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 14,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            📋 Unscheduled Tasks ({unscheduled.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unscheduled.map((t: Task) => {
              const col = COLUMNS.find((c) => c.id === t.status);
              return (
                <span
                  key={t.id}
                  title={t.responsible}
                  style={{
                    background: col?.color || "#888",
                    color: "#fff",
                    borderRadius: 4,
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  {(t.description || "").slice(0, 28)}
                  {isAdmin || isManager ? ` (${t.responsible || ""})` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Day Expand Modal */}
      {expandDay && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setExpandDay(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              width: 500,
              maxWidth: "94vw",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}
                >
                  📅 {expandDateStr}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {expandTasks.length} task{expandTasks.length !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={() => setExpandDay(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#64748b",
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Task list */}
            <div
              style={{
                overflowY: "auto",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {expandTasks.map((t: Task, i: number) => {
                const col = COLUMNS.find((c) => c.id === t.status);
                const isRec = t.recurrence && t.recurrence !== "Onetime";
                return (
                  <div
                    key={t.id + "-exp-" + i}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "10px 12px",
                      borderLeft: `4px solid ${col?.color || "#888"}`,
                      background: "#fafafa",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          background: col?.color || "#888",
                          color: "#fff",
                          fontSize: 10,
                          padding: "2px 7px",
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        {t.status}
                      </span>
                      {isRec && (
                        <span
                          style={{
                            background: "#ede9fe",
                            color: "#7c3aed",
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          ⟳ {t.recurrence}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 11,
                          color: "#64748b",
                          marginLeft: "auto",
                        }}
                      >
                        {t.client}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#1e293b",
                        marginBottom: 2,
                      }}
                    >
                      {t.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        fontSize: 11,
                        color: "#64748b",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>👤 {t.responsible}</span>
                      <span>🏷 {t.category}</span>
                      {t.remarks && <span>💬 {t.remarks}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
