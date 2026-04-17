import { useState } from "react";
import { avatarColor } from "@/utils/avatar";
import TaskDrillModal from "./TaskDrillModal";
import type { Task, Profile } from "@/types";

export interface TeamTableProps {
  tasks: Task[];
  teamNames: string[];
  todayStr: string;
  onSelectMember: (name: string) => void;
  onTaskUpdated: () => void;
  onPatchTask?: (
    taskId: string,
    patch: {
      targetDate?: string | null;
      expectedDate?: string | null;
      completedDate?: string | null;
      remarks?: string;
    },
  ) => Promise<void>;
  profile: Profile | null;
}

interface CountCellProps {
  count: number;
  color: string;
  taskList: Task[];
  label: string;
  onDrill: (title: string, tasks: Task[]) => void;
}

function CountCell({ count, color, taskList, label, onDrill }: CountCellProps) {
  return (
    <td style={{ textAlign: "center", padding: "8px 6px" }}>
      {count > 0 ? (
        <button
          onClick={() => onDrill(label, taskList)}
          style={{
            background: "none",
            border: "none",
            color,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 13,
            textDecoration: "underline",
            textUnderlineOffset: 2,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {count}
        </button>
      ) : (
        <span style={{ color: "#9ca3af", fontSize: 13 }}>0</span>
      )}
    </td>
  );
}

export default function TeamTable({
  tasks,
  teamNames,
  todayStr,
  onSelectMember,
  onTaskUpdated,
  onPatchTask,
  profile,
}: TeamTableProps) {
  const [drill, setDrill] = useState<{ title: string; tasks: Task[] } | null>(
    null,
  );

  const openDrill = (title: string, filtered: Task[]) =>
    setDrill({ title, tasks: filtered });

  return (
    <>
      <div className="sticky-table-wrap">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {[
                "Member",
                "Total",
                "✅ On Time",
                "⏱ Delayed",
                "🔄 Active",
                "📅 Today",
                "🔴 Overdue",
                "Progress",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: h === "Member" ? "left" : "center",
                    fontWeight: 700,
                    color: h === "📅 Today" ? "#0891b2" : "#475569",
                    fontSize: 12,
                    borderBottom: "2px solid #e2e8f0",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teamNames.map((name) => {
              const mine = tasks.filter((t) => t.responsible === name);
              const ontime = mine.filter((t) => t.status === "Ontime");
              const delayed = mine.filter(
                (t) => t.status === "Completed Delay",
              );
              const active = mine.filter(
                (t) =>
                  ["Pending", "TodayTask", "Tomorrow", "TBC"].includes(
                    t.status,
                  ) && t.targetDate !== todayStr,
              );
              const today = mine.filter((t) => t.targetDate === todayStr);
              const overdue = mine.filter((t) => t.status === "Overdue");
              const done = ontime.length + delayed.length;
              const pct = mine.length
                ? Math.round((done / mine.length) * 100)
                : 0;
              const color = avatarColor(name);
              return (
                <tr key={name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {name.slice(0, 2).toUpperCase()}
                      </div>
                      <button
                        onClick={() => onSelectMember(name)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2563eb",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontSize: 13,
                          padding: 0,
                          textDecoration: "underline",
                        }}
                      >
                        {name}
                      </button>
                    </div>
                  </td>
                  <CountCell
                    count={mine.length}
                    color="#1e293b"
                    taskList={mine}
                    label={`${name} — All Tasks`}
                    onDrill={openDrill}
                  />
                  <CountCell
                    count={ontime.length}
                    color="#15803d"
                    taskList={ontime}
                    label={`${name} — On Time`}
                    onDrill={openDrill}
                  />
                  <CountCell
                    count={delayed.length}
                    color="#7c3aed"
                    taskList={delayed}
                    label={`${name} — Delayed`}
                    onDrill={openDrill}
                  />
                  <CountCell
                    count={active.length}
                    color="#d97706"
                    taskList={active}
                    label={`${name} — Active`}
                    onDrill={openDrill}
                  />
                  <CountCell
                    count={today.length}
                    color="#0891b2"
                    taskList={today}
                    label={`${name} — Today`}
                    onDrill={openDrill}
                  />
                  <td style={{ textAlign: "center", padding: "8px 6px" }}>
                    {overdue.length > 0 ? (
                      <button
                        onClick={() => openDrill(`${name} — Overdue`, overdue)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#dc2626",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: 13,
                          textDecoration: "underline",
                          textUnderlineOffset: 2,
                          padding: "2px 6px",
                        }}
                      >
                        ⚠ {overdue.length}
                      </button>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 120 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 7,
                          background: "#e5e7eb",
                          borderRadius: 4,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            borderRadius: 4,
                            background:
                              pct >= 80
                                ? "#22c55e"
                                : pct >= 50
                                  ? "#f59e0b"
                                  : "#ef4444",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          minWidth: 34,
                          textAlign: "right",
                        }}
                      >
                        {pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drill && (
        <TaskDrillModal
          title={drill.title}
          tasks={drill.tasks}
          onClose={() => setDrill(null)}
          onTaskUpdated={onTaskUpdated}
          onPatchTask={onPatchTask}
          profile={profile}
        />
      )}
    </>
  );
}
