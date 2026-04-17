import { useState, useMemo } from "react";
import { localDateStr } from "@/utils/date";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import { toMins, fromMins } from "@/utils/time";
import type { WorkPlan } from "@/types";

interface WorkPlanCalendarProps {
  plans: WorkPlan[];
  calMonth: string;
  setCalMonth: (month: string) => void;
  allMemberNames: string[];
}

export default function WorkPlanCalendar({
  plans,
  calMonth,
  setCalMonth,
  allMemberNames,
}: WorkPlanCalendarProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [year, month] = calMonth.split("-").map(Number);

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1);
    setCalMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };
  const nextMonth = () => {
    const d = new Date(year, month, 1);
    setCalMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };
  const goToday = () => setCalMonth(new Date().toISOString().slice(0, 7));

  // Assign a stable color to each employee name (alphabetically from all members)
  const empColorMap = useMemo(() => {
    const names = [
      ...new Set([
        ...allMemberNames,
        ...plans.map((p) => p.name).filter(Boolean),
      ]),
    ].sort();
    const m: Record<string, MemberPalette> = {};
    names.forEach((n, i) => {
      m[n] = EMP_COLORS[i % EMP_COLORS.length];
    });
    return m;
  }, [allMemberNames, plans]);

  // All employee names that have plans in current filtered set
  const activeEmployees = useMemo(
    () => [...new Set(plans.map((p) => p.name).filter(Boolean))].sort(),
    [plans],
  );

  // Group plans by date
  const plansByDate = useMemo(() => {
    const m: Record<string, WorkPlan[]> = {};
    plans.forEach((p) => {
      if (!p.date) return;
      if (!m[p.date]) m[p.date] = [];
      m[p.date].push(p);
    });
    return m;
  }, [plans]);

  // Build full calendar grid starting on Monday
  const calDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const offset = startDow === 0 ? 6 : startDow - 1; // shift so Mon=0
    const start = new Date(firstDay);
    start.setDate(start.getDate() - offset);
    const days = [];
    const cur = new Date(start);
    while (cur.getMonth() !== month || cur.getDate() <= lastDay.getDate()) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
      if (days.length > 42) break;
    }
    // Pad to complete last week
    while (days.length % 7 !== 0) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [year, month]);

  const toStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = localDateStr(new Date());
  const dayPlans = selectedDay ? plansByDate[selectedDay] || [] : [];
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Month navigation bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            padding: "5px 14px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            background: "#fff",
            fontWeight: 700,
          }}
        >
          ‹
        </button>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontWeight: 800,
            fontSize: 17,
            color: "#1e293b",
          }}
        >
          {monthLabel}
        </div>
        <button
          onClick={goToday}
          style={{
            padding: "5px 12px",
            border: "1.5px solid #2563eb",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            background: "#eff6ff",
            color: "#2563eb",
            fontWeight: 700,
          }}
        >
          Today
        </button>
        <button
          onClick={nextMonth}
          style={{
            padding: "5px 14px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            background: "#fff",
            fontWeight: 700,
          }}
        >
          ›
        </button>
      </div>

      {/* Employee colour legend */}
      {activeEmployees.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            padding: "8px 12px",
            background: "#f8fafc",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              alignSelf: "center",
              marginRight: 4,
            }}
          >
            LEGEND:
          </span>
          {activeEmployees.map((n) => {
            const c = empColorMap[n] || EMP_COLORS[0];
            return (
              <span
                key={n}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1.5px solid ${c.dot}`,
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                ></span>
                {n}
              </span>
            );
          })}
          {activeEmployees.length === 0 && (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              No plans match current filters.
            </span>
          )}
        </div>
      )}

      {/* Calendar grid */}
      <div
        style={{
          border: "1.5px solid #e2e8f0",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,.06)",
        }}
      >
        {/* Day-of-week headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#f1f5f9",
            borderBottom: "2px solid #e2e8f0",
          }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              style={{
                padding: "8px 6px",
                textAlign: "center",
                fontWeight: 700,
                fontSize: 12,
                color: d === "Sat" || d === "Sun" ? "#ef4444" : "#475569",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {calDays.map((day, i) => {
            const ds = toStr(day);
            const inMonth = day.getMonth() === month - 1;
            const isToday = ds === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const entries = plansByDate[ds] || [];
            const isSelected = ds === selectedDay;
            const hasPlans = entries.length > 0;
            const isLastInRow = (i + 1) % 7 === 0;
            const isLastRow = i >= calDays.length - 7;

            return (
              <div
                key={ds}
                onClick={() => setSelectedDay(isSelected ? null : ds)}
                style={{
                  minHeight: 96,
                  padding: "6px 5px 5px",
                  borderRight: !isLastInRow ? "1px solid #f1f5f9" : "none",
                  borderBottom: !isLastRow ? "1px solid #f1f5f9" : "none",
                  background: isSelected
                    ? "#eff6ff"
                    : isToday
                      ? "#fefce8"
                      : isWeekend
                        ? "#fafafa"
                        : "#fff",
                  cursor: hasPlans ? "pointer" : "default",
                  opacity: inMonth ? 1 : 0.3,
                  transition: "background .12s",
                  position: "relative",
                }}
              >
                {/* Date number */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isToday ? "#2563eb" : "transparent",
                      color: isToday
                        ? "#fff"
                        : isWeekend
                          ? "#ef4444"
                          : "#374151",
                    }}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {/* Plan chips — show up to 3, then +N more */}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  {entries.slice(0, 3).map((entry: WorkPlan, ei: number) => {
                    const c = empColorMap[entry.name] || EMP_COLORS[0];
                    const initials = (entry.name || "?")
                      .split(" ")
                      .map((w: string) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    const label =
                      entry.client ||
                      entry.task_description ||
                      entry.name;
                    return (
                      <div
                        key={entry.id || ei}
                        title={`${entry.name}${entry.client ? " → " + entry.client : ""}\n${entry.task_description || ""}${entry.hours_planned ? " (" + entry.hours_planned + "hrs)" : ""}`}
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
                  {entries.length > 3 && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        fontWeight: 600,
                        paddingLeft: 2,
                      }}
                    >
                      +{entries.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div
          style={{
            marginTop: 14,
            background: "#fff",
            border: "1.5px solid #bfdbfe",
            borderRadius: 10,
            boxShadow: "0 4px 20px rgba(37,99,235,.12)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div>
              <span style={{ fontWeight: 800, fontSize: 15, color: "#1e293b" }}>
                📅{" "}
                {new Date(selectedDay + "T00:00:00").toLocaleDateString(
                  "en-IN",
                  {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  },
                )}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  fontWeight: 400,
                  marginLeft: 10,
                }}
              >
                {dayPlans.length} plan{dayPlans.length !== 1 ? "s" : ""}
                {dayPlans.length > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span style={{ color: "#2563eb", fontWeight: 700 }}>
                      {fromMins(
                        dayPlans.reduce(
                          (s: number, p: WorkPlan) =>
                            s + toMins(p.hours_planned),
                          0,
                        ),
                      )}{" "}
                      planned hrs
                    </span>
                  </>
                )}
              </span>
            </div>
            <button
              onClick={() => setSelectedDay(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#94a3b8",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {dayPlans.length === 0 ? (
            <p
              style={{
                color: "#94a3b8",
                fontSize: 13,
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              No plans on this day.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 10,
              }}
            >
              {dayPlans.map((entry: WorkPlan, i: number) => {
                const c = empColorMap[entry.name] || EMP_COLORS[0];
                const initials = (entry.name || "?")
                  .split(" ")
                  .map((w: string) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <div
                    key={entry.id || i}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: c.bg,
                      border: `1.5px solid ${c.dot}`,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: c.dot,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ fontWeight: 700, color: c.text, fontSize: 13 }}
                      >
                        {entry.name}
                      </div>
                      {entry.client && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#475569",
                            marginTop: 3,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>🏢</span>
                          <span
                            style={{
                              background: "#fff",
                              padding: "1px 7px",
                              borderRadius: 4,
                              border: `1px solid ${c.dot}`,
                              fontWeight: 600,
                            }}
                          >
                            {entry.client}
                          </span>
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          color: "#374151",
                          marginTop: 4,
                          lineHeight: 1.4,
                        }}
                      >
                        📋 {entry.task_description}
                      </div>
                      {entry.hours_planned && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#2563eb",
                            marginTop: 4,
                            fontWeight: 700,
                          }}
                        >
                          ⏱ {entry.hours_planned} hrs
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Drill-down Modal ───────────────────────────────────────────────────────
