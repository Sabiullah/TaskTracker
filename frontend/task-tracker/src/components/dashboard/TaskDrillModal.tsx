import { useState, useEffect, useMemo } from "react";
import { COLUMNS, computeStatus } from "@/utils/task";
import type { Task } from "@/types";
import type { Profile } from "@/types";

import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";

export interface TaskDrillPatch {
  targetDate?: string | null;
  expectedDate?: string | null;
  completedDate?: string | null;
  remarks?: string;
  description?: string;
  client?: string | null;
  responsible?: string | null;
  reportingManager?: string | null;
}

export interface TaskDrillModalProps {
  title: string;
  tasks: Task[];
  onClose: () => void;
  onTaskUpdated?: () => void;
  onPatchTask?: (taskId: string, patch: TaskDrillPatch) => Promise<void>;
  /**
   * Kept on the props surface for backwards-compatibility — callers like
   * TeamTable / ClientTable still forward this from DashboardPage. With
   * inline-edit-everything for admins, the modal no longer triggers it on
   * row click; the prop is unused here but accepting it keeps the public
   * shape stable and avoids churn at the call sites.
   */
  onEditTaskFull?: (task: Task) => void;
  profile: Profile | null;
}

interface AdminEdit {
  description: string;
  client: string;
  responsible: string;
  reportingManager: string;
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  remarks: string;
}

interface ManagerEdit {
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  remarks: string;
}

interface UserEdit {
  expectedDate: string;
  completedDate: string;
  remarks: string;
}

type RowEdit = AdminEdit | ManagerEdit | UserEdit;

export default function TaskDrillModal({
  title,
  tasks,
  onClose,
  onTaskUpdated,
  onPatchTask,
  onEditTaskFull: _onEditTaskFull,
  profile: _profile,
}: TaskDrillModalProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const isPriv = isManagerInAny();
  const { clients: clientMasters } = useMasters();
  const { profiles } = useProfiles();
  const [localTasks, setLocalTasks] = useState(tasks);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.resolve().then(() => {
      setLocalTasks(tasks);
      setEdits({});
    });
  }, [tasks]);

  // Per-task org for filtering dropdown options. The modal can show tasks
  // spanning multiple orgs (Akilan's "Overdue" pile is across clients), so
  // dropdowns are scoped to the row's own org rather than a global selector.
  const orgUidByTask = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of localTasks) m[t.id] = t.organization || "";
    return m;
  }, [localTasks]);

  const clientsForOrg = (orgUid: string) =>
    clientMasters
      .filter((c) => c.type === "client")
      .filter((c) => {
        if (!orgUid) return true;
        const orgs = c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [];
        return orgs.includes(orgUid);
      })
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));

  const membersForOrg = (orgUid: string) => {
    const names = profiles
      .filter((p) =>
        orgUid ? p.orgs.some((o) => o.uid === orgUid) : true,
      )
      .map((p) => p.full_name)
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  };

  const startEdit = (t: Task) => {
    if (edits[t.id]) return;
    if (isAdmin) {
      setEdits((e) => ({
        ...e,
        [t.id]: {
          description: t.description || "",
          client: t.client || "",
          responsible: t.responsible || "",
          reportingManager: t.reportingManager || "",
          targetDate: t.targetDate || "",
          expectedDate: t.expectedDate || "",
          completedDate: t.completedDate || "",
          remarks: t.remarks || "",
        } satisfies AdminEdit,
      }));
      return;
    }
    if (isPriv) {
      setEdits((e) => ({
        ...e,
        [t.id]: {
          targetDate: t.targetDate || "",
          expectedDate: t.expectedDate || "",
          completedDate: t.completedDate || "",
          remarks: t.remarks || "",
        } satisfies ManagerEdit,
      }));
      return;
    }
    setEdits((e) => ({
      ...e,
      [t.id]: {
        expectedDate: t.expectedDate || "",
        completedDate: t.completedDate || "",
        remarks: t.remarks || "",
      } satisfies UserEdit,
    }));
  };

  const setField = (id: string, k: keyof AdminEdit, v: string) =>
    setEdits((e) => {
      const current = e[id];
      if (!current) return e;
      // The spread preserves whichever RowEdit variant was set in
      // ``startEdit``; we only ever update keys that exist on that variant
      // (callers gate the call by role), so the resulting object stays a
      // valid RowEdit. The double-cast through ``unknown`` is needed
      // because the discriminated union members don't share an index
      // signature.
      const next = { ...(current as object), [k]: v };
      return { ...e, [id]: next as unknown as RowEdit };
    });

  const cancelEdit = (id: string) =>
    setEdits((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });

  const nameToClientUid = (name: string) =>
    clientMasters.find((c) => c.type === "client" && c.name === name)?.id ?? null;

  const nameToProfileUid = (name: string) =>
    profiles.find((p) => p.full_name === name)?.id ?? null;

  const saveRow = async (t: Task) => {
    const d = edits[t.id];
    if (!d) return;
    setSaving((s) => ({ ...s, [t.id]: true }));
    try {
      if (onPatchTask) {
        const patch: TaskDrillPatch = {
          expectedDate: d.expectedDate || null,
          completedDate: d.completedDate || null,
          remarks: d.remarks,
        };
        if (isPriv || isAdmin) {
          (patch as TaskDrillPatch).targetDate =
            (d as ManagerEdit).targetDate || null;
        }
        if (isAdmin) {
          const a = d as AdminEdit;
          patch.description = a.description;
          // For FK fields, only include when the user picked a value. Empty
          // string in the dropdown means "leave unchanged" rather than
          // "clear" — server-side a missing key on a PATCH is "no change",
          // matching the UX of the inline edit.
          if (a.client) patch.client = nameToClientUid(a.client);
          if (a.responsible)
            patch.responsible = nameToProfileUid(a.responsible);
          if (a.reportingManager)
            patch.reportingManager = nameToProfileUid(a.reportingManager);
        }
        await onPatchTask(t.id, patch);
      }
    } catch (err) {
      alert("Save failed: " + String(err));
      setSaving((s) => ({ ...s, [t.id]: false }));
      return;
    }
    setSaving((s) => ({ ...s, [t.id]: false }));
    const updatedTask: Task = {
      ...t,
      ...(isAdmin
        ? {
            description: (d as AdminEdit).description,
            client: (d as AdminEdit).client,
            responsible: (d as AdminEdit).responsible,
            reportingManager: (d as AdminEdit).reportingManager,
          }
        : {}),
      ...(isPriv || isAdmin
        ? { targetDate: (d as ManagerEdit).targetDate }
        : {}),
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
          maxWidth: 1280,
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
              {isAdmin
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
                  const ed = edits[t.id];
                  const adminEd = isAdmin && ed ? (ed as AdminEdit) : null;
                  const isSaved = saved[t.id];
                  const rowBg = isSaved
                    ? "#f0fdf4"
                    : ed
                      ? "#fffbeb"
                      : i % 2 === 0
                        ? "#fff"
                        : "#fafafa";
                  const orgUid = orgUidByTask[t.id] || "";
                  const clientOpts = adminEd ? clientsForOrg(orgUid) : [];
                  const memberOpts = adminEd ? membersForOrg(orgUid) : [];
                  return (
                    <tr
                      key={t.id || i}
                      onClick={() => {
                        if (ed) return;
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
                          : isAdmin
                            ? "Click to edit any field"
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
                          padding: adminEd ? "5px 8px" : "7px 12px",
                          fontWeight: 500,
                          maxWidth: adminEd ? undefined : 240,
                          minWidth: adminEd ? 220 : undefined,
                        }}
                      >
                        {adminEd ? (
                          <input
                            type="text"
                            value={adminEd.description}
                            onChange={(e) =>
                              setField(t.id, "description", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            {t.parentId ? "↳ " : ""}
                            {t.description || (t.parentId ? `Sub of #${t.serialNo ?? ""}` : "")}
                          </>
                        )}
                      </td>
                      <td
                        style={{
                          padding: adminEd ? "5px 8px" : "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          minWidth: adminEd ? 130 : undefined,
                        }}
                      >
                        {adminEd ? (
                          <select
                            value={adminEd.client}
                            onChange={(e) =>
                              setField(t.id, "client", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— Select —</option>
                            {/* Surface the current value even if it's not in the
                                org-scoped list (legacy data, renamed client).
                                Without this fallback the select would silently
                                blank-out an existing assignment. */}
                            {adminEd.client &&
                              !clientOpts.includes(adminEd.client) && (
                                <option value={adminEd.client}>
                                  {adminEd.client}
                                </option>
                              )}
                            {clientOpts.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          t.client || "—"
                        )}
                      </td>
                      <td
                        style={{
                          padding: adminEd ? "5px 8px" : "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          minWidth: adminEd ? 140 : undefined,
                        }}
                      >
                        {adminEd ? (
                          <select
                            value={adminEd.responsible}
                            onChange={(e) =>
                              setField(t.id, "responsible", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— Select —</option>
                            {adminEd.responsible &&
                              !memberOpts.includes(adminEd.responsible) && (
                                <option value={adminEd.responsible}>
                                  {adminEd.responsible}
                                </option>
                              )}
                            {memberOpts.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          t.responsible || "—"
                        )}
                      </td>
                      <td
                        style={{
                          padding: adminEd ? "5px 8px" : "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          minWidth: adminEd ? 140 : undefined,
                        }}
                      >
                        {adminEd ? (
                          <select
                            value={adminEd.reportingManager}
                            onChange={(e) =>
                              setField(t.id, "reportingManager", e.target.value)
                            }
                            style={inStyle}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— Select —</option>
                            {adminEd.reportingManager &&
                              !memberOpts.includes(adminEd.reportingManager) && (
                                <option value={adminEd.reportingManager}>
                                  {adminEd.reportingManager}
                                </option>
                              )}
                            {memberOpts.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          t.reportingManager || "—"
                        )}
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
                          padding: ed && (isPriv || isAdmin) ? "5px 8px" : "7px 12px",
                          minWidth: ed && (isPriv || isAdmin) ? 120 : undefined,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ed && (isPriv || isAdmin) ? (
                          <input
                            type="date"
                            value={(ed as ManagerEdit).targetDate || ""}
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
