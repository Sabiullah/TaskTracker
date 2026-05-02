import { useState } from "react";
import TaskDrillModal from "./TaskDrillModal";
import type { Task, Profile } from "@/types";
import type { TaskPatch } from "@/hooks/useTasks";

export interface ClientTableProps {
  tasks: Task[];
  clientNames: string[];
  todayStr: string;
  onSelectClient: (client: string) => void;
  onTaskUpdated: () => void;
  onPatchTask?: (taskId: string, patch: TaskPatch) => Promise<void>;
  profile: Profile | null;
  onEditTaskFull?: (task: Task) => void;
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

export default function ClientTable({
  tasks,
  clientNames,
  todayStr,
  onSelectClient,
  onTaskUpdated,
  onPatchTask,
  profile,
  onEditTaskFull,
}: ClientTableProps) {
  const [drill, setDrill] = useState<{ title: string; tasks: Task[] } | null>(
    null,
  );

  const openDrill = (title: string, filtered: Task[]) =>
    setDrill({ title, tasks: filtered });

  const sortedNames = [...clientNames].sort((a, b) => {
    const ca = tasks.filter((t) => t.client === a).length;
    const cb = tasks.filter((t) => t.client === b).length;
    return cb - ca;
  });

  return (
    <>
      <div className="sticky-table-wrap">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {[
                "Client",
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
                    textAlign: h === "Client" ? "left" : "center",
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
            {sortedNames.map((name) => {
              const mine = tasks.filter((t) => t.client === name);
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
              return (
                <tr key={name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <button
                      onClick={() => onSelectClient(name)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#2563eb",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: 13,
                        padding: 0,
                        textDecoration: "underline",
                        textAlign: "left",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 160,
                      }}
                      title={name}
                    >
                      {name}
                    </button>
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
          onEditTaskFull={onEditTaskFull}
        />
      )}
    </>
  );
}
