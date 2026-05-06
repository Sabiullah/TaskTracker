import { useMemo, useState } from "react";
import { avatarColor } from "@/utils/avatar";
import TaskDrillModal from "./TaskDrillModal";
import type { Task, Profile } from "@/types";
import type { TaskPatch } from "@/hooks/useTasks";

export interface TeamTableProps {
  tasks: Task[];
  teamNames: string[];
  todayStr: string;
  onSelectMember: (name: string) => void;
  onTaskUpdated: () => void;
  onPatchTask?: (taskId: string, patch: TaskPatch) => Promise<void>;
  profile: Profile | null;
  onEditTaskFull?: (task: Task) => void;
}

type SortKey =
  | "name"
  | "total"
  | "ontime"
  | "delayed"
  | "active"
  | "today"
  | "overdue"
  | "progress";
type SortDir = "asc" | "desc";

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Member" },
  { key: "total", label: "Total" },
  { key: "ontime", label: "✅ On Time" },
  { key: "delayed", label: "⏱ Delayed" },
  { key: "active", label: "🔄 Active" },
  { key: "today", label: "📅 Today" },
  { key: "overdue", label: "🔴 Overdue" },
  { key: "progress", label: "Progress" },
];

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
  onEditTaskFull,
}: TeamTableProps) {
  const [drill, setDrill] = useState<{ title: string; tasks: Task[] } | null>(
    null,
  );
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const openDrill = (title: string, filtered: Task[]) =>
    setDrill({ title, tasks: filtered });

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    return teamNames.map((name) => {
      const mine = tasks.filter((t) => t.responsible === name);
      const ontime = mine.filter((t) => t.status === "Ontime");
      const delayed = mine.filter((t) => t.status === "Completed Delay");
      const active = mine.filter(
        (t) =>
          ["Pending", "TodayTask", "Tomorrow", "TBC"].includes(t.status) &&
          t.targetDate !== todayStr,
      );
      const today = mine.filter((t) => t.targetDate === todayStr);
      const overdue = mine.filter((t) => t.status === "Overdue");
      const done = ontime.length + delayed.length;
      const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
      return { name, mine, ontime, delayed, active, today, overdue, pct };
    });
  }, [tasks, teamNames, todayStr]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const out = [...rows];
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "total":
          cmp = a.mine.length - b.mine.length;
          break;
        case "ontime":
          cmp = a.ontime.length - b.ontime.length;
          break;
        case "delayed":
          cmp = a.delayed.length - b.delayed.length;
          break;
        case "active":
          cmp = a.active.length - b.active.length;
          break;
        case "today":
          cmp = a.today.length - b.today.length;
          break;
        case "overdue":
          cmp = a.overdue.length - b.overdue.length;
          break;
        case "progress":
          cmp = a.pct - b.pct;
          break;
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return cmp * dir;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  return (
    <>
      <div className="sticky-table-wrap">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {HEADERS.map(({ key, label }) => {
                const isActive = sortKey === key;
                const arrow = isActive ? (sortDir === "asc" ? "▲" : "▼") : "";
                return (
                  <th
                    key={key}
                    onClick={() => onHeaderClick(key)}
                    title={`Sort by ${label}`}
                    style={{
                      padding: "8px 12px",
                      textAlign: key === "name" ? "left" : "center",
                      fontWeight: 700,
                      color: key === "today" ? "#0891b2" : "#475569",
                      fontSize: 12,
                      borderBottom: "2px solid #e2e8f0",
                      cursor: "pointer",
                      userSelect: "none",
                      background: isActive ? "#eff6ff" : "transparent",
                    }}
                  >
                    {label}
                    {arrow && (
                      <span style={{ marginLeft: 4, color: "#2563eb" }}>
                        {arrow}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(
              ({ name, mine, ontime, delayed, active, today, overdue, pct }) => {
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
          onEditTaskFull={onEditTaskFull}
        />
      )}
    </>
  );
}
