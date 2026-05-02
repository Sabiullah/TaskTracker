import { useState, useEffect, type ReactNode } from "react";
import { COLUMNS, RECURRENCE_OPTIONS, computeStatus } from "@/utils/task";
import { exportCSV } from "@/utils/csv";
import type { Task, Profile } from "@/types";

import { useAuth } from "@/hooks/useAuth";
import type { TaskPatch } from "@/hooks/useTasks";

export interface TaskDetailTableProps {
  tasks: Task[];
  title: ReactNode;
  onBack?: () => void;
  filename?: string;
  editable?: boolean;
  profile?: Profile | null;
  sortField?: string;
  sortDir?: "asc" | "desc";
  onSort?: (field: string) => void;
  onAddTask?: (() => void) | null;
  onPatchTask?: (taskId: string, patch: TaskPatch) => Promise<void>;
}

export default function TaskDetailTable({
  tasks,
  title,
  onBack,
  filename,
  editable = false,
  profile: _profile = null,
  sortField = "",
  sortDir = "asc",
  onSort,
  onAddTask = null,
  onPatchTask,
}: TaskDetailTableProps) {
  const { isManagerInAny } = useAuth();
  const isPriv =
    editable && (isManagerInAny());
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.resolve().then(() => { setLocalTasks(tasks); setEdits({}); });
  }, [tasks]);

  const getRK = (t: Task & { _rowKey?: string }) => t._rowKey || t.id;

  const startEdit = (t: Task) => {
    const rk = getRK(t);
    if (!isPriv || (edits as Record<string, unknown>)[rk]) return;
    setEdits((e) => ({
      ...e,
      [rk]: {
        targetDate: t.targetDate || "",
        expectedDate: t.expectedDate || "",
        completedDate: t.completedDate || "",
        remarks: t.remarks || "",
      },
    }));
  };
  const setField = (id: string, k: string, v: string) =>
    setEdits((e) => ({
      ...e,
      [id]: { ...(e as Record<string, Record<string, string>>)[id], [k]: v },
    }));
  const cancelEdit = (id: string) =>
    setEdits((e) => {
      const n = { ...e } as Record<string, unknown>;
      delete n[id];
      return n;
    });

  const saveRow = async (t: Task) => {
    const rk = getRK(t);
    const d = (edits as Record<string, Record<string, string>>)[rk];
    if (!d) return;
    setSaving((s) => ({ ...s, [rk]: true }));
    try {
      if (onPatchTask) {
        await onPatchTask(t.id, {
          targetDate: d.targetDate || null,
          expectedDate: d.expectedDate || null,
          completedDate: d.completedDate || null,
          remarks: d.remarks,
        });
      }
    } catch (err) {
      alert("Save failed: " + String(err));
      setSaving((s) => ({ ...s, [rk]: false }));
      return;
    }
    setSaving((s) => ({ ...s, [rk]: false }));
    const updated = { ...t, targetDate: d.targetDate, expectedDate: d.expectedDate, completedDate: d.completedDate, remarks: d.remarks };
    updated.status = computeStatus(updated);
    setLocalTasks((prev) => prev.map((r) => (getRK(r) === rk ? updated : r)));
    cancelEdit(rk);
    setSaved((s) => ({ ...s, [rk]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [rk]: false })), 2000);
  };

  const inS: React.CSSProperties = {
    padding: "3px 6px",
    border: "1.5px solid #2563eb",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      className="dm-box"
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        <span style={{ fontSize: 13, color: "#64748b" }}>
          ({localTasks.length} tasks)
        </span>
        {isPriv && (
          <span style={{ fontSize: 11, color: "#64748b" }}>
            ✏️ Click a row to edit Target Date, Expected Date, Comp Date &amp;
            Remarks
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onAddTask && (
            <button
              onClick={onAddTask}
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              + Add Task
            </button>
          )}
          <button
            onClick={() =>
              exportCSV(
                localTasks.map((t) => ({
                  "#": t.serialNo || "",
                  Description: t.description || "",
                  Client: t.client || "",
                  Category: t.category || "",
                  Responsible: t.responsible || "",
                  Recurrence: t.recurrence || "Onetime",
                  Status: t.status || "",
                  "Target Date": t.targetDate || "",
                  "Expected Date": t.expectedDate || "",
                  "Completed Date": t.completedDate || "",
                  Remarks: t.remarks || "",
                })),
                filename || "tasks.csv",
              )
            }
            style={{
              padding: "6px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            ⬇ Export CSV
          </button>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                padding: "6px 14px",
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
      {localTasks.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>
          No tasks found.
        </p>
      ) : (
        <div className="sticky-table-wrap">
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "#",
                  "Task",
                  "Client",
                  "Category",
                  "Responsible",
                  "Recurrence",
                  "Status",
                  "Target Date",
                  "Expected Date",
                  "Completed Date",
                  "Remarks",
                  ...(isPriv ? ["Actions"] : []),
                ].map((h) => {
                  const sortKey =
                    h === "Responsible"
                      ? "responsible"
                      : h === "Target Date"
                        ? "targetDate"
                        : null;
                  const isActive = sortField === sortKey;
                  const arrow = isActive
                    ? sortDir === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅";
                  return (
                    <th
                      key={h}
                      onClick={() => sortKey && onSort && onSort(sortKey)}
                      style={{
                        padding: "8px 10px",
                        textAlign: "left",
                        fontWeight: 700,
                        color: isActive ? "#2563eb" : "#475569",
                        fontSize: 12,
                        borderBottom: "2px solid #e2e8f0",
                        whiteSpace: "nowrap",
                        cursor: sortKey ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      {h}
                      {sortKey && (
                        <span
                          style={{ fontSize: 10, opacity: isActive ? 1 : 0.4 }}
                        >
                          {arrow}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {localTasks.map((t, idx) => {
                const rk = getRK(t);
                const col = (
                  COLUMNS as Array<{ id: string; color: string }>
                ).find((c) => c.id === t.status);
                const rec = (
                  RECURRENCE_OPTIONS as Array<{
                    value: string;
                    label: string;
                    color: string;
                  }>
                ).find((r) => r.value === (t.recurrence || "Onetime"));
                const ed = (edits as Record<string, Record<string, string>>)[
                  rk
                ];
                const isSaved = saved[rk];
                const rowBg = isSaved
                  ? "#f0fdf4"
                  : ed
                    ? "#fffbeb"
                    : idx % 2 === 0
                      ? "#fff"
                      : "#fafafa";
                return (
                  <tr
                    key={rk}
                    onClick={() => isPriv && !ed && startEdit(t)}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: rowBg,
                      cursor: isPriv && !ed ? "pointer" : "default",
                      transition: "background .15s",
                    }}
                    title={isPriv && !ed ? "Click to edit" : ""}
                  >
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#94a3b8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.serialNo}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontWeight: 500,
                        minWidth: 180,
                      }}
                    >
                      {t.description}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.client || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.category || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.responsible || "—"}
                    </td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                      {rec && rec.value !== "Onetime" ? (
                        <span
                          style={{
                            background: rec.color + "18",
                            color: rec.color,
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          ⟳ {rec.label}
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>
                          One-time
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          background: (col?.color || "#888") + "22",
                          color: col?.color || "#888",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: ed ? "5px 8px" : "7px 10px",
                        minWidth: ed ? 120 : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ed ? (
                        <input
                          type="date"
                          value={ed.targetDate}
                          onChange={(e2) =>
                            setField(rk, "targetDate", e2.target.value)
                          }
                          style={inS}
                          onClick={(e2) => e2.stopPropagation()}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color:
                              t.status === "Overdue" ? "#dc2626" : "#64748b",
                          }}
                        >
                          {t.targetDate || "—"}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: ed ? "5px 8px" : "7px 10px",
                        minWidth: ed ? 120 : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ed ? (
                        <input
                          type="date"
                          value={ed.expectedDate}
                          onChange={(e2) =>
                            setField(rk, "expectedDate", e2.target.value)
                          }
                          style={inS}
                          onClick={(e2) => e2.stopPropagation()}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          {t.expectedDate || "—"}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: ed ? "5px 8px" : "7px 10px",
                        minWidth: ed ? 120 : undefined,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ed ? (
                        <input
                          type="date"
                          value={ed.completedDate}
                          onChange={(e2) =>
                            setField(rk, "completedDate", e2.target.value)
                          }
                          style={inS}
                          onClick={(e2) => e2.stopPropagation()}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          {t.completedDate || "—"}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: ed ? "5px 8px" : "7px 10px",
                        minWidth: ed ? 180 : 150,
                      }}
                    >
                      {ed ? (
                        <input
                          type="text"
                          value={ed.remarks}
                          onChange={(e2) =>
                            setField(rk, "remarks", e2.target.value)
                          }
                          placeholder="Add remarks…"
                          style={inS}
                          onClick={(e2) => e2.stopPropagation()}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          {t.remarks || "—"}
                        </span>
                      )}
                    </td>
                    {isPriv && (
                      <td
                        style={{ padding: "5px 8px", whiteSpace: "nowrap" }}
                        onClick={(e2) => e2.stopPropagation()}
                      >
                        {isSaved && !ed && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#16a34a",
                              fontWeight: 700,
                            }}
                          >
                            ✓ Saved
                          </span>
                        )}
                        {ed && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              onClick={() => saveRow(t)}
                              disabled={saving[rk]}
                              style={{
                                padding: "3px 10px",
                                background: "#16a34a",
                                color: "#fff",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {saving[rk] ? "…" : "✓ Save"}
                            </button>
                            <button
                              onClick={() => cancelEdit(rk)}
                              style={{
                                padding: "3px 8px",
                                background: "#f1f5f9",
                                border: "1px solid #e2e8f0",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
