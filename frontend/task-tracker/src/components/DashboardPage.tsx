import React, { useState, useMemo } from "react";
import { COLUMNS, AVATAR_COLORS, RECURRENCE_OPTIONS } from "@/constants";
import {
  hasRecurringInstance,
  getProjectedDate,
  computeStatus,
} from "@/lib/taskUtils";
import { apiPatch } from "@/lib/api";
import type {
  DashboardTask,
  DashboardProfile,
  DrillDownState,
  TaskDetailTableProps,
  StatusDistProps,
  ClientDistProps,
  TaskDrillModalProps,
  TeamTableProps,
  MultiSelectProps,
  ReportViewProps,
  RecentCompletionsProps,
  DashboardPageProps,
} from "@/types";

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

/* ── CSV Export ─────────────────────────────────────────────────────────── */
function exportCSV(tasks: DashboardTask[], filename: string = "tasks.csv") {
  const esc = (v: unknown) => `"${String(v || "").replace(/"/g, '""')}"`;
  const headers = [
    "#",
    "Description",
    "Client",
    "Category",
    "Responsible",
    "Recurrence",
    "Status",
    "Target Date",
    "Expected Date",
    "Comp Date",
    "Remarks",
  ];
  const rows = tasks.map((t: DashboardTask) =>
    [
      t.s_no || "",
      esc(t.description),
      esc(t.client),
      esc(t.category),
      esc(t.responsible),
      esc(t.recurrence || "Onetime"),
      esc(t.status),
      t.target_date || "",
      t.expected_date || "",
      t.comp_date || "",
      esc(t.remarks),
    ].join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Shared Task Table (with Remarks) ──────────────────────────────────── */
function TaskDetailTable({
  tasks,
  title,
  onBack,
  filename,
}: TaskDetailTableProps) {
  return (
    <div
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
          ({tasks.length} tasks)
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => exportCSV(tasks, filename || "tasks.csv")}
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
      {tasks.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>
          No tasks found.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
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
                  "Target",
                  "Expected",
                  "Completed",
                  "Remarks",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 10px",
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
              {tasks.map((t: DashboardTask) => {
                const col = COLUMNS.find((c) => c.id === t.status);
                const rec = RECURRENCE_OPTIONS.find(
                  (r) => r.value === (t.recurrence || "Onetime"),
                );
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#94a3b8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.s_no}
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
                        padding: "7px 10px",
                        fontSize: 12,
                        color: t.status === "Overdue" ? "#dc2626" : "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.target_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.expected_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.comp_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        minWidth: 150,
                      }}
                    >
                      {t.remarks || "—"}
                    </td>
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

/* ── Status Distribution (clickable) ───────────────────────────────────── */
function StatusDist({ tasks, onSelectStatus }: StatusDistProps) {
  const total = tasks.length || 1;
  return (
    <div>
      {COLUMNS.map((col) => {
        const cnt = tasks.filter(
          (t: DashboardTask) => t.status === col.id,
        ).length;
        const pct = Math.round((cnt / total) * 100);
        return (
          <div
            key={col.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <button
              onClick={() => cnt > 0 && onSelectStatus(col.id)}
              style={{
                width: 120,
                fontSize: 11,
                color: cnt > 0 ? "#2563eb" : "#64748b",
                flexShrink: 0,
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: cnt > 0 ? "pointer" : "default",
                fontWeight: cnt > 0 ? 600 : 400,
                textDecoration: cnt > 0 ? "underline" : "none",
              }}
            >
              {col.title}
            </button>
            <div
              style={{
                flex: 1,
                height: 8,
                background: "#e5e7eb",
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: col.color,
                  borderRadius: 4,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                minWidth: 24,
                textAlign: "right",
              }}
            >
              {cnt}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Client Distribution (clickable) ───────────────────────────────────── */
function ClientDist({ tasks, onSelectClient }: ClientDistProps) {
  const map: Record<string, number> = {};
  tasks.forEach((t: DashboardTask) => {
    if (t.client) map[t.client] = (map[t.client] || 0) + 1;
  });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]); // show ALL clients, no slice
  const max = entries[0]?.[1] || 1;
  if (!entries.length)
    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No data</p>;
  return (
    <div
      style={{
        maxHeight: 320,
        overflowY: entries.length > 8 ? "auto" : "visible",
        paddingRight: entries.length > 8 ? 4 : 0,
      }}
    >
      {entries.map(([name, cnt]) => (
        <div
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <button
            onClick={() => onSelectClient(name)}
            style={{
              width: 130,
              fontSize: 11,
              color: "#2563eb",
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              fontWeight: 600,
              textDecoration: "underline",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </button>
          <div
            style={{
              flex: 1,
              height: 8,
              background: "#e5e7eb",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: `${Math.round((cnt / max) * 100)}%`,
                height: "100%",
                background: "#2563eb",
                borderRadius: 4,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              minWidth: 24,
              textAlign: "right",
            }}
          >
            {cnt}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Team Performance — Task Drill-down Modal (with inline edit) ─────────── */
function TaskDrillModal({
  title,
  tasks,
  onClose,
  onTaskUpdated,
}: TaskDrillModalProps) {
  const [localTasks, setLocalTasks] = useState<DashboardTask[]>(tasks);
  const [edits, setEdits] = useState<
    Record<string, { expectedDate: string; compDate: string; remarks: string }>
  >({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const startEdit = (t: DashboardTask) => {
    if (edits[t.id]) return; // already editing
    setEdits((e) => ({
      ...e,
      [t.id]: {
        expectedDate: t.expected_date || "",
        compDate: t.comp_date || "",
        remarks: t.remarks || "",
      },
    }));
  };
  const setField = (
    id: string,
    k: keyof { expectedDate: string; compDate: string; remarks: string },
    v: string,
  ) => setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const cancelEdit = (id: string) =>
    setEdits((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });

  const saveRow = async (t: DashboardTask) => {
    const d = edits[t.id];
    if (!d) return;
    setSaving((s) => ({ ...s, [t.id]: true }));
    const updated: DashboardTask = {
      ...t,
      expected_date: d.expectedDate,
      comp_date: d.compDate,
      remarks: d.remarks,
    };
    updated.status = computeStatus(updated);
    const { error } = await apiPatch(`/tasks/${t.id}/`, {
      expected_date: d.expectedDate || null,
      comp_date: d.compDate || null,
      remarks: d.remarks,
    })
      .then(() => ({ error: null }))
      .catch((e) => ({ error: { message: (e as Error).message } }));
    setSaving((s) => ({ ...s, [t.id]: false }));
    if (error) {
      alert("Save failed: " + error.message);
      return;
    }
    // Immediately update local task list — no waiting for reload
    const updatedTask: DashboardTask = {
      ...t,
      expected_date: d.expectedDate,
      comp_date: d.compDate,
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
          maxWidth: 1000,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
              ✏️ Click a row to edit Expected Date, Comp Date &amp; Remarks
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

        {/* Task list */}
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
                {localTasks.map((t: DashboardTask, i: number) => {
                  const col = COLUMNS.find((c) => c.id === t.status);
                  const ed = edits[t.id];
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
                      onClick={() => !ed && startEdit(t)}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: rowBg,
                        cursor: ed ? "default" : "pointer",
                        transition: "background .2s",
                      }}
                      title={
                        ed
                          ? ""
                          : "Click to edit Expected Date, Comp Date & Remarks"
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
                        {t.s_no || i + 1}
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
                                comp_date: edits[t.id]?.compDate || t.comp_date,
                              })
                            : t.status}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          fontSize: 12,
                          color: t.status === "Overdue" ? "#dc2626" : "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.target_date || "—"}
                      </td>

                      {/* Expected Date — editable */}
                      <td style={{ padding: "5px 8px", minWidth: 130 }}>
                        {ed ? (
                          <input
                            type="date"
                            value={ed.expectedDate}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) => setField(t.id, "expectedDate", e.target.value)}
                            style={inStyle}
                            onClick={(e: React.MouseEvent) =>
                              e.stopPropagation()
                            }
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {t.expected_date || "—"}
                          </span>
                        )}
                      </td>

                      {/* Comp Date — editable */}
                      <td style={{ padding: "5px 8px", minWidth: 130 }}>
                        {ed ? (
                          <input
                            type="date"
                            value={ed.compDate}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) => setField(t.id, "compDate", e.target.value)}
                            style={inStyle}
                            onClick={(e: React.MouseEvent) =>
                              e.stopPropagation()
                            }
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {t.comp_date || "—"}
                          </span>
                        )}
                      </td>

                      {/* Remarks — editable */}
                      <td style={{ padding: "5px 8px", minWidth: 180 }}>
                        {ed ? (
                          <input
                            type="text"
                            value={ed.remarks}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) => setField(t.id, "remarks", e.target.value)}
                            placeholder="Add remarks…"
                            style={inStyle}
                            onClick={(e: React.MouseEvent) =>
                              e.stopPropagation()
                            }
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

                      {/* Save / Cancel */}
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
                            onClick={(e: React.MouseEvent) =>
                              e.stopPropagation()
                            }
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

/* ── Team Performance Table ─────────────────────────────────────────────── */
function TeamTable({
  tasks,
  teamNames,
  onSelectMember,
  onTaskUpdated,
}: TeamTableProps) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [drill, setDrill] = useState<{
    title: string;
    tasks: DashboardTask[];
  } | null>(null); // { title, tasks }

  const openDrill = (title: string, filtered: DashboardTask[]) =>
    setDrill({ title, tasks: filtered });

  // Clickable count cell
  const CountCell = ({
    count,
    color,
    taskList,
    label,
  }: {
    count: number;
    color: string;
    taskList: DashboardTask[];
    label: string;
  }) => (
    <td style={{ textAlign: "center", padding: "8px 6px" }}>
      {count > 0 ? (
        <button
          onClick={() => openDrill(label, taskList)}
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

  return (
    <>
      <div style={{ overflowX: "auto" }}>
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
            {teamNames.map((name: string) => {
              const mine = tasks.filter(
                (t: DashboardTask) => t.responsible === name,
              );
              const ontime = mine.filter(
                (t: DashboardTask) => t.status === "Ontime",
              );
              const delayed = mine.filter(
                (t: DashboardTask) => t.status === "Completed Delay",
              );
              const active = mine.filter(
                (t: DashboardTask) =>
                  ["Pending", "TodayTask", "Tomorrow", "TBC"].includes(
                    t.status,
                  ) && t.target_date !== todayStr,
              );
              const today = mine.filter(
                (t: DashboardTask) => t.target_date === todayStr,
              );
              const overdue = mine.filter(
                (t: DashboardTask) => t.status === "Overdue",
              );
              const done = ontime.length + delayed.length;
              const pct = mine.length
                ? Math.round((done / mine.length) * 100)
                : 0;
              const color = AVATAR_COLORS[name] || "#64748b";
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
                  />
                  <CountCell
                    count={ontime.length}
                    color="#15803d"
                    taskList={ontime}
                    label={`${name} — On Time`}
                  />
                  <CountCell
                    count={delayed.length}
                    color="#7c3aed"
                    taskList={delayed}
                    label={`${name} — Delayed`}
                  />
                  <CountCell
                    count={active.length}
                    color="#d97706"
                    taskList={active}
                    label={`${name} — Active`}
                  />
                  <CountCell
                    count={today.length}
                    color="#0891b2"
                    taskList={today}
                    label={`${name} — Today`}
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
        />
      )}
    </>
  );
}

/* ── Multi-Select Dropdown ──────────────────────────────────────────────── */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = "All",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val: string) => {
    if (selected.includes(val))
      onChange(selected.filter((v: string) => v !== val));
    else onChange([...selected, val]);
  };
  const selectAll = () => onChange([...options]);
  const clearAll = () => onChange([]);
  const isAll = selected.length === 0;
  const displayText = isAll
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 160 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "6px 10px",
          border: `1.5px solid ${open ? "#2563eb" : "#e2e8f0"}`,
          borderRadius: 6,
          fontSize: 13,
          background: "#fff",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 6,
          color: isAll ? "#94a3b8" : "#1e293b",
          fontWeight: isAll ? 400 : 600,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 500,
            background: "#fff",
            border: "1.5px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            minWidth: 200,
            maxHeight: 260,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Select All / Clear */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 10px",
              borderBottom: "1px solid #f1f5f9",
              flexShrink: 0,
            }}
          >
            <button
              onClick={selectAll}
              style={{
                flex: 1,
                padding: "3px 0",
                fontSize: 11,
                fontWeight: 600,
                color: "#2563eb",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              ✓ All
            </button>
            <button
              onClick={clearAll}
              style={{
                flex: 1,
                padding: "3px 0",
                fontSize: 11,
                fontWeight: 600,
                color: "#64748b",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              ✕ Clear
            </button>
          </div>
          {/* Options */}
          <div style={{ overflowY: "auto", maxHeight: 200 }}>
            {options.map((opt: string) => (
              <label
                key={opt}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  cursor: "pointer",
                  background: selected.includes(opt)
                    ? "#eff6ff"
                    : "transparent",
                  borderBottom: "1px solid #f8fafc",
                  fontSize: 13,
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) =>
                  (e.currentTarget.style.background = selected.includes(opt)
                    ? "#dbeafe"
                    : "#f8fafc")
                }
                onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) =>
                  (e.currentTarget.style.background = selected.includes(opt)
                    ? "#eff6ff"
                    : "transparent")
                }
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  style={{
                    width: 14,
                    height: 14,
                    accentColor: "#2563eb",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: selected.includes(opt) ? "#1d4ed8" : "#374151",
                    fontWeight: selected.includes(opt) ? 600 : 400,
                  }}
                >
                  {opt}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Full Report View ───────────────────────────────────────────────────── */
function ReportView({ tasks, onBack }: ReportViewProps) {
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fClient, setFClient] = useState<string[]>([]);
  const [fMember, setFMember] = useState<string[]>([]);
  const [fRecurrence, setFRecurrence] = useState<string[]>([]);

  const statuses = [
    ...new Set(tasks.map((t) => t.status).filter(Boolean)),
  ].sort();
  const clients = [
    ...new Set(tasks.map((t) => t.client).filter(Boolean)),
  ].sort();
  const members = [
    ...new Set(tasks.map((t) => t.responsible).filter(Boolean)),
  ].sort();
  const recOpts = RECURRENCE_OPTIONS.map((r) => r.value);

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t: DashboardTask) =>
          (!fStatus.length || fStatus.includes(t.status)) &&
          (!fClient.length || fClient.includes(t.client)) &&
          (!fMember.length || fMember.includes(t.responsible)) &&
          (!fRecurrence.length ||
            fRecurrence.includes(t.recurrence || "Onetime")),
      ),
    [tasks, fStatus, fClient, fMember, fRecurrence],
  );

  const hasFilter =
    fStatus.length || fClient.length || fMember.length || fRecurrence.length;

  return (
    <div
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
        <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Full Task Report</div>
        <span style={{ fontSize: 13, color: "#64748b" }}>
          ({filtered.length} tasks)
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => exportCSV(filtered, "task-report.csv")}
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
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
          padding: "12px",
          background: "#f8fafc",
          borderRadius: 8,
          alignItems: "flex-end",
        }}
      >
        <MultiSelect
          label="Status"
          options={statuses}
          selected={fStatus}
          onChange={setFStatus}
          allLabel="All Statuses"
        />
        <MultiSelect
          label="Client"
          options={clients}
          selected={fClient}
          onChange={setFClient}
          allLabel="All Clients"
        />
        <MultiSelect
          label="Member"
          options={members}
          selected={fMember}
          onChange={setFMember}
          allLabel="All Members"
        />
        <MultiSelect
          label="Recurrence"
          options={recOpts}
          selected={fRecurrence}
          onChange={setFRecurrence}
          allLabel="All Types"
        />
        {hasFilter ? (
          <button
            onClick={() => {
              setFStatus([]);
              setFClient([]);
              setFMember([]);
              setFRecurrence([]);
            }}
            style={{
              padding: "6px 12px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            ✕ Clear All
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>
          No tasks match the selected filters.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
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
                  "Target",
                  "Expected",
                  "Completed",
                  "Remarks",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 10px",
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
              {filtered.map((t: DashboardTask) => {
                const col = COLUMNS.find((c) => c.id === t.status);
                const rec = RECURRENCE_OPTIONS.find(
                  (r) => r.value === (t.recurrence || "Onetime"),
                );
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#94a3b8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.s_no}
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
                        padding: "7px 10px",
                        fontSize: 12,
                        color: t.status === "Overdue" ? "#dc2626" : "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.target_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.expected_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.comp_date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontSize: 12,
                        color: "#64748b",
                        minWidth: 150,
                      }}
                    >
                      {t.remarks || "—"}
                    </td>
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

/* ── Recent Completions ─────────────────────────────────────────────────── */
function RecentCompletions({ tasks }: RecentCompletionsProps) {
  const completed = tasks
    .filter((t: DashboardTask) =>
      ["Ontime", "Completed Delay"].includes(t.status),
    )
    .slice(-5)
    .reverse();
  if (!completed.length)
    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No completions yet</p>;
  return (
    <div>
      {completed.map((t: DashboardTask) => (
        <div
          key={t.id}
          style={{
            padding: "8px 0",
            borderBottom: "1px solid #f1f5f9",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>{t.description}</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            {t.client} · {t.comp_date || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main Dashboard Page ────────────────────────────────────────────────── */
export default function DashboardPage({
  tasks,
  profile,
  profiles = [],
}: DashboardPageProps) {
  const [period, setPeriod] = useState("");
  // drillDown: null | { type: 'member'|'status'|'client'|'report', value?: string }
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  const now = new Date();
  const monthOptions = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthOptions.push({
      v,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const myName = profile?.full_name || profile?.name || "";
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";

  const filteredTasks = useMemo(() => {
    let src = tasks;

    if (period) {
      const [selY, selM] = period.split("-").map(Number);
      const selMonth = selM - 1; // 0-based

      src = src
        .map((t: DashboardTask) => {
          const r = t.recurrence || "Onetime";
          if (r === "Onetime") {
            // Onetime: include only if targetDate is in selected month
            return (t.target_date || "").startsWith(period) ? t : null;
          }
          // Recurring: project to selected month if it has an instance
          if (!hasRecurringInstance(t, selY, selMonth)) return null;
          const projectedDate = getProjectedDate(t, selY, selMonth);
          const origMonth = (t.target_date || "").slice(0, 7);
          const isDiffCycle = origMonth !== period;
          const projectedTask: DashboardTask = {
            ...t,
            target_date: projectedDate,
            ...(isDiffCycle
              ? { expected_date: "", comp_date: "", remarks: "" }
              : {}),
          };
          return { ...projectedTask, status: computeStatus(projectedTask) };
        })
        .filter(Boolean) as DashboardTask[];
    }

    if (!isAdmin) {
      if (isManager) {
        const managedNames = profiles
          .filter((p: DashboardProfile) =>
            (p.manager_ids?.length
              ? p.manager_ids
              : p.manager_id
                ? [p.manager_id]
                : []
            ).includes(profile?.id),
          )
          .map((p: DashboardProfile) => p.full_name || "");
        src = src.filter(
          (t: DashboardTask) =>
            t.responsible === myName || managedNames.includes(t.responsible),
        );
      } else {
        src = src.filter((t: DashboardTask) => t.responsible === myName);
      }
    }
    return src;
  }, [tasks, period, isAdmin, isManager, myName, profiles, profile]);

  const teamNames = [
    ...new Set(filteredTasks.map((t) => t.responsible).filter(Boolean)),
  ];
  const todayStr = now.toISOString().slice(0, 10);
  const todayTasks = filteredTasks.filter((t) => t.target_date === todayStr);
  const done = filteredTasks.filter((t) =>
    ["Ontime", "Completed Delay"].includes(t.status),
  ).length;
  const overdue = filteredTasks.filter((t) => t.status === "Overdue").length;
  const pct = filteredTasks.length
    ? Math.round((done / filteredTasks.length) * 100)
    : 0;

  const cardStyle = (color: string) => ({
    background: "#fff",
    borderRadius: 10,
    padding: "16px 20px",
    borderTop: `4px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    minWidth: 120,
  });
  const boxStyle = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 12,
  };

  // ── Drill-down views ──────────────────────────────────────────────────
  if (drillDown?.type === "report") {
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <ReportView tasks={filteredTasks} onBack={() => setDrillDown(null)} />
      </div>
    );
  }

  if (drillDown?.type === "status") {
    const col = COLUMNS.find((c) => c.id === drillDown.value);
    const slice = filteredTasks.filter((t) => t.status === drillDown.value);
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <TaskDetailTable
          tasks={slice}
          title={
            <span>
              Tasks with status:{" "}
              <span style={{ color: col?.color || "#888", fontWeight: 700 }}>
                {drillDown.value}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`status-${drillDown.value}.csv`}
        />
      </div>
    );
  }

  if (drillDown?.type === "client") {
    const slice = filteredTasks.filter((t) => t.client === drillDown.value);
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <TaskDetailTable
          tasks={slice}
          title={
            <span>
              Tasks for client:{" "}
              <span style={{ color: "#2563eb", fontWeight: 700 }}>
                {drillDown.value}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`client-${drillDown.value}.csv`}
        />
      </div>
    );
  }

  if (drillDown?.type === "active") {
    const activeTasks = filteredTasks.filter(
      (t) =>
        !["Ontime", "Completed Delay"].includes(t.status) &&
        t.target_date !== todayStr,
    );
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <TaskDetailTable
          tasks={activeTasks}
          title="🔄 Active Tasks (excluding today)"
          onBack={() => setDrillDown(null)}
          filename="active-tasks.csv"
        />
      </div>
    );
  }

  if (drillDown?.type === "today") {
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <TaskDetailTable
          tasks={todayTasks}
          title={
            <span>
              📅 Today's Tasks —{" "}
              <span style={{ color: "#0891b2", fontWeight: 700 }}>
                {now.toLocaleDateString("en-IN", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`today-tasks-${todayStr}.csv`}
        />
      </div>
    );
  }

  if (drillDown?.type === "member") {
    const name = drillDown.value;
    const mine = filteredTasks.filter((t) => t.responsible === name);
    const color = AVATAR_COLORS[name] || "#64748b";
    const mdone = mine.filter((t) =>
      ["Ontime", "Completed Delay"].includes(t.status),
    ).length;
    const mpct = mine.length ? Math.round((mdone / mine.length) * 100) : 0;
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1200, margin: "0 auto" }}>
        <div
          style={{
            ...boxStyle,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{name}</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              {mine.length} task(s) · {mpct}% completion
            </div>
          </div>
          <button
            onClick={() => setDrillDown(null)}
            style={{
              marginLeft: "auto",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
        <TaskDetailTable
          tasks={mine}
          title={`All tasks — ${name}`}
          filename={`member-${name}.csv`}
        />
      </div>
    );
  }

  // ── Main dashboard ────────────────────────────────────────────────────
  return (
    <div style={{ padding: "16px 20px", maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          📊{" "}
          {isAdmin
            ? "Team Dashboard"
            : isManager
              ? `My Team Dashboard — ${myName}`
              : `My Dashboard — ${myName}`}
        </div>
        <button
          onClick={() => setDrillDown({ type: "report" })}
          style={{
            padding: "7px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          📋 Full Report
        </button>
      </div>

      {/* Period filter */}
      <div
        style={{ ...boxStyle, display: "flex", alignItems: "center", gap: 10 }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
          Month:
        </span>
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setDrillDown(null);
          }}
          style={{
            padding: "6px 10px",
            border: "2px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <option value="">All Time</option>
          {monthOptions.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </select>
        {period && (
          <button
            onClick={() => {
              setPeriod("");
              setDrillDown(null);
            }}
            style={{
              padding: "5px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              cursor: "pointer",
            }}
          >
            ✕ Clear
          </button>
        )}
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => exportCSV(filteredTasks, "all-tasks.csv")}
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
        </div>
      </div>

      {/* Stat cards */}
      <div
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}
      >
        <div style={cardStyle("#2563eb")}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {filteredTasks.length}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {isAdmin ? "Total Tasks" : isManager ? "Team Tasks" : "My Tasks"}
          </div>
        </div>
        <div style={cardStyle("#15803d")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#15803d" }}>
            {done}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Completed
          </div>
        </div>
        <div
          onClick={() => setDrillDown({ type: "active" })}
          style={{ ...cardStyle("#d97706"), cursor: "pointer" }}
          title="Click to view active tasks"
        >
          <div style={{ fontSize: 28, fontWeight: 800, color: "#d97706" }}>
            {
              filteredTasks.filter(
                (t) =>
                  !["Ontime", "Completed Delay"].includes(t.status) &&
                  t.target_date !== todayStr,
              ).length
            }
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Active
          </div>
        </div>
        <div
          onClick={() => setDrillDown({ type: "today" })}
          style={{ ...cardStyle("#0891b2"), cursor: "pointer" }}
          title="Click to view today's tasks"
        >
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0891b2" }}>
            {todayTasks.length}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Today
          </div>
        </div>
        <div style={cardStyle("#dc2626")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#dc2626" }}>
            {overdue}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Overdue
          </div>
        </div>
        <div style={cardStyle("#7c3aed")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#7c3aed" }}>
            {pct}%
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Completion Rate
          </div>
        </div>
      </div>

      {/* Admin / Manager team view */}
      {isAdmin || isManager ? (
        <>
          <div style={boxStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              👥 {isAdmin ? "Team" : "My Team"} Performance
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
                {" "}
                (click member name to view tasks)
              </span>
            </div>
            <TeamTable
              tasks={filteredTasks}
              teamNames={teamNames}
              onSelectMember={(name) =>
                setDrillDown({ type: "member", value: name })
              }
              onTaskUpdated={() => {}}
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                📈 Status Distribution
                <span
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}
                >
                  {" "}
                  (click to view tasks)
                </span>
              </div>
              <StatusDist
                tasks={filteredTasks}
                onSelectStatus={(s) =>
                  setDrillDown({ type: "status", value: s })
                }
              />
            </div>
            <div style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                🏢 By Client
                <span
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}
                >
                  {" "}
                  (click to view tasks)
                </span>
              </div>
              <ClientDist
                tasks={filteredTasks}
                onSelectClient={(c) =>
                  setDrillDown({ type: "client", value: c })
                }
              />
            </div>
          </div>
        </>
      ) : (
        /* Employee view */
        <>
          <div style={boxStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              📋 Active Tasks{" "}
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
                (excluding today's tasks)
              </span>
            </div>
            <TaskDetailTable
              tasks={filteredTasks.filter(
                (t) =>
                  !["Ontime", "Completed Delay"].includes(t.status) &&
                  t.target_date !== todayStr,
              )}
              title=""
              filename={`my-active-tasks.csv`}
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                📈 Status Distribution
              </div>
              <StatusDist
                tasks={filteredTasks}
                onSelectStatus={(s) =>
                  setDrillDown({ type: "status", value: s })
                }
              />
            </div>
            <div style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                ✅ Recent Completions
              </div>
              <RecentCompletions tasks={filteredTasks} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
