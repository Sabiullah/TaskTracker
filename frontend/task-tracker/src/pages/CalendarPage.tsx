import { useState, type CSSProperties } from "react";
import { COLUMNS } from "@/utils/task";
import type { Profile, Task, TaskStatus } from "@/types";
import {
  computeStatus,
  getProjectedDate,
  hasRecurringInstance,
} from "@/utils/task";

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
const navBtn: CSSProperties = {
  padding: "6px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#f8fafc",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

interface CalendarPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles?: Profile[];
}

export default function CalendarPage({
  tasks,
  profile,
  profiles = [],
}: CalendarPageProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [expandDay, setExpandDay] = useState<number | null>(null);
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const myName = profile?.full_name || "";

  let visible = tasks;
  if (!isAdmin && !isManager) {
    visible = tasks.filter((t) => t.responsible === myName);
  } else if (isManager && profile) {
    const managedNames = profiles
      .filter((p) => (p.manager_ids ?? []).includes(profile.id))
      .map((p) => p.full_name || "");
    visible = tasks.filter(
      (t) => t.responsible === myName || managedNames.includes(t.responsible),
    );
  }

  const monthTasks: Task[] = [];
  const unscheduled: Task[] = [];

  visible.forEach((t) => {
    const r = t.recurrence || "Onetime";
    if (!t.targetDate) {
      unscheduled.push(t);
      return;
    }
    if (r === "Onetime") {
      const taskMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
      if (t.targetDate.startsWith(taskMonth)) monthTasks.push(t);
    } else if (hasRecurringInstance(t, year, month)) {
      const projectedDate = getProjectedDate(t, year, month);
      const origMonth = (t.targetDate || "").slice(0, 7);
      const calMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
      const isDiffCycle = origMonth !== calMonth;
      const projectedTask: Task = {
        ...t,
        targetDate: projectedDate,
        ...(isDiffCycle
          ? { expectedDate: "", completedDate: "", remarks: "" }
          : {}),
      };
      const taskStatus = computeStatus(projectedTask);
      monthTasks.push({ ...projectedTask, status: taskStatus });
    }
  });

  // Derive unique client & member lists from all visible tasks
  const clientOptions = [
    ...new Set(visible.map((t) => t.client).filter(Boolean)),
  ].sort();
  const memberOptions = [
    ...new Set(visible.map((t) => t.responsible).filter(Boolean)),
  ].sort();

  // Apply client/member filters
  const filteredMonthTasks = monthTasks.filter(
    (t) =>
      (!fClient || t.client === fClient) &&
      (!fMember || t.responsible === fMember),
  );

  // Group by day number — Overdue tasks always first
  const STATUS_ORDER: Record<TaskStatus, number> = {
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
  filteredMonthTasks.forEach((t) => {
    const d = parseInt(t.targetDate.split("-")[2]);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(t);
  });
  Object.values(byDay).forEach((arr) => {
    arr.sort(
      (a, b) =>
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
          className="page-title"
          style={{ fontSize: 20, minWidth: 180, textAlign: "center" }}
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

      {/* Filters + Legend row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <select
          value={fClient}
          onChange={(e) => {
            setFClient(e.target.value);
            setExpandDay(null);
          }}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            fontSize: 12,
            color: "#475569",
            background: "#fff",
            cursor: "pointer",
            width: 150,
          }}
        >
          <option value="">All Clients</option>
          {clientOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={fMember}
          onChange={(e) => {
            setFMember(e.target.value);
            setExpandDay(null);
          }}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            fontSize: 12,
            color: "#475569",
            background: "#fff",
            cursor: "pointer",
            width: 150,
          }}
        >
          <option value="">All Members</option>
          {memberOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {(fClient || fMember) && (
          <button
            onClick={() => {
              setFClient("");
              setFMember("");
              setExpandDay(null);
            }}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #fca5a5",
              background: "#fee2e2",
              color: "#dc2626",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ✕ Clear
          </button>
        )}
        {(fClient || fMember) && (
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
            {filteredMonthTasks.length} task
            {filteredMonthTasks.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Legend inline */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginLeft: "auto",
            alignItems: "center",
          }}
        >
          {COLUMNS.map((c) => (
            <span
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                color: "#1e293b",
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: c.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {c.title}
            </span>
          ))}
          <span style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>
            ⟳ = Recurring
          </span>
        </div>
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
                onClick={() => dt.length > 0 && setExpandDay(d)}
                style={{
                  minHeight: 90,
                  padding: 4,
                  borderRight: "1px solid #f1f5f9",
                  borderBottom: "1px solid #f1f5f9",
                  background: isToday ? "#eff6ff" : "white",
                  cursor: dt.length > 0 ? "pointer" : "default",
                  position: "relative",
                }}
              >
                {/* Date number row */}
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
                      color: isToday ? "#fff" : "#374151",
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      textAlign: "center",
                      lineHeight: "22px",
                    }}
                  >
                    {d}
                  </span>
                  {dt.length > 0 && (
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
                      {dt.length} ⤢
                    </span>
                  )}
                </div>

                {/* Task chips */}
                {visible3.map((t, i) => {
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
                        cursor: "pointer",
                      }}
                    >
                      {isRec ? "⟳ " : ""}
                      {(t.description || "").slice(0, 16)}
                      {(t.description || "").length > 16 ? "…" : ""}
                    </div>
                  );
                })}

                {/* "+N more" label */}
                {extra > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#2563eb",
                      fontWeight: 600,
                      padding: "1px 0",
                    }}
                  >
                    +{extra} more
                  </div>
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
            {unscheduled.map((t) => {
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
              {expandTasks.map((t, i) => {
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
