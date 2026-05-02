import { useState, useEffect } from "react";
import { COLUMNS, computeStatus } from "@/utils/task";
import type { Task } from "@/types";
import type { Profile } from "@/types";

import { useAuth } from "@/hooks/useAuth";

export interface TaskDrillModalProps {
  title: string;
  tasks: Task[];
  onClose: () => void;
  onTaskUpdated?: () => void;
  onPatchTask?: (taskId: string, patch: { targetDate?: string | null; expectedDate?: string | null; completedDate?: string | null; remarks?: string }) => Promise<void>;
  onEditTaskFull?: (task: Task) => void;
  profile: Profile | null;
}

export default function TaskDrillModal({
  title,
  tasks,
  onClose,
  onTaskUpdated,
  onPatchTask,
  onEditTaskFull,
  profile: _profile,
}: TaskDrillModalProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const isPriv = isManagerInAny();
  const [localTasks, setLocalTasks] = useState(tasks);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.resolve().then(() => {
      setLocalTasks(tasks);
      setEdits({});
    });
  }, [tasks]);

  const startEdit = (t: Task) => {
    if ((edits as Record<string, unknown>)[t.id]) return;
    setEdits((e) => ({
      ...e,
      [t.id]: {
        ...(isPriv && { targetDate: t.targetDate || "" }),
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
    const d = (edits as Record<string, Record<string, string>>)[t.id];
    if (!d) return;
    setSaving((s) => ({ ...s, [t.id]: true }));
    try {
      if (onPatchTask) {
        await onPatchTask(t.id, {
          expectedDate: d.expectedDate || null,
          completedDate: d.completedDate || null,
          remarks: d.remarks,
          ...(isPriv && { targetDate: d.targetDate || null }),
        });
      }
    } catch (err) {
      alert("Save failed: " + String(err));
      setSaving((s) => ({ ...s, [t.id]: false }));
      return;
    }
    setSaving((s) => ({ ...s, [t.id]: false }));
    const updatedTask = {
      ...t,
      ...(isPriv && { targetDate: d.targetDate }),
      expectedDate: d.expectedDate,
      completedDate: d.completedDate,
      remarks: d.remarks,
    };
    updatedTask.status = computeStatus(updatedTask);
    setLocalTasks((prev) => prev.map((r) => (r.id === t.id ? updatedTask : r)));
    cancelEdit(t.id);
    setSaved((s) => ({ ...s, [t.id]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [t.id]: false })), 2000);
    if (onTaskUpdated) onTaskUpdated();
  };

  const inStyle: React.CSSProperties = {
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 0,
          width: "95vw",
          maxWidth: 1120,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
            <span
              style={{
                color: "#94a3b8",
                fontWeight: 400,
                fontSize: 13,
                marginLeft: 6,
              }}
            >
              ({tasks.length} task{tasks.length !== 1 ? "s" : ""})
            </span>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 12 }}>
              {isAdmin && onEditTaskFull
                ? "✏️ Click a row to edit any field"
                : `✏️ Click a row to edit ${isPriv ? "Target Date, " : ""}Expected Date, Comp Date & Remarks`}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {tasks.length === 0 ? (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: 32 }}>
              No tasks.
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f8fafc",
                  zIndex: 1,
                }}
              >
                <tr>
                  {[
                    "#",
                    "Description",
                    "Client",
                    "Responsible",
                    "Reporting Manager",
                    "Status",
                    "Target Date",
                    "Expected Date",
                    "Comp Date",
                    "Remarks",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        fontWeight: 700,
                        color: "#475569",
                        fontSize: 12,
                        borderBottom: "2px solid #e2e8f0",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localTasks.map((t, i) => {
                  const col = (
                    COLUMNS as Array<{ id: string; color: string }>
                  ).find((c) => c.id === t.status);
                  const ed = (edits as Record<string, Record<string, string>>)[
                    t.id
                  ];
                  const isSaved = saved[t.id];
                  const rowBg = isSaved
                    ? "#f0fdf4"
                    : ed
                      ? "#fffbeb"
                      : i % 2 === 0
                        ? "#fff"
                        : "#fafafa";
                  return (
                    <tr
                      key={t.id || i}
                      onClick={() => {
                        if (ed) return;
                        if (isAdmin && onEditTaskFull) {
                          onEditTaskFull(t);
                          onClose();
                          return;
                        }
                        startEdit(t);
                      }}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: rowBg,
                        cursor: ed ? "default" : "pointer",
                        transition: "background .2s",
                      }}
                      title={
                        ed
                          ? ""
                          : isAdmin && onEditTaskFull
                            ? "Click to open full editor"
                            : `Click to edit ${isPriv ? "Target Date, " : ""}Expected Date, Comp Date & Remarks`
                      }
                    >
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#94a3b8",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.serialNo || i + 1}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          fontWeight: 500,
                          maxWidth: 240,
                        }}
                      >
                        {t.description}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.client || "—"}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.responsible || "—"}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.reportingManager || "—"}
                      </td>
                      <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
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
                          {isSaved
                            ? computeStatus({
                                ...t,
                                completedDate:
                                  ed?.completedDate || t.completedDate,
                              })
                            : t.status}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: ed && isPriv ? "5px 8px" : "7px 12px",
                          minWidth: ed && isPriv ? 120 : undefined,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ed && isPriv ? (
                          <input
                            type="date"
                            value={ed.targetDate || ""}
                            onChange={(e) =>
                              setField(t.id, "targetDate", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
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
                      <td style={{ padding: "5px 8px", minWidth: 130 }}>
                        {ed ? (
                          <input
                            type="date"
                            value={ed.expectedDate}
                            onChange={(e) =>
                              setField(t.id, "expectedDate", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {t.expectedDate || "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "5px 8px", minWidth: 130 }}>
                        {ed ? (
                          <input
                            type="date"
                            value={ed.completedDate}
                            onChange={(e) =>
                              setField(t.id, "completedDate", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {t.completedDate || "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "5px 8px", minWidth: 180 }}>
                        {ed ? (
                          <input
                            type="text"
                            value={ed.remarks}
                            onChange={(e) =>
                              setField(t.id, "remarks", e.target.value)
                            }
                            placeholder="Add remarks…"
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {t.remarks || (
                              <span
                                style={{
                                  color: "#cbd5e1",
                                  fontStyle: "italic",
                                }}
                              >
                                click to add
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
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
                          <div
                            style={{ display: "flex", gap: 4 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => saveRow(t)}
                              disabled={saving[t.id]}
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
                              {saving[t.id] ? "…" : "✓ Save"}
                            </button>
                            <button
                              onClick={() => cancelEdit(t.id)}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
