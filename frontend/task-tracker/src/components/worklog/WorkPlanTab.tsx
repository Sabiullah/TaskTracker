import { useMemo, useState } from "react";
import type React from "react";
import {
  ApiError,
  apiDelete,
  apiPatch,
} from "@/lib/api";
import type { WorkPlanDto, WorkPlanUpdate } from "@/types/api";
import { toMins, fromMins, validTime } from "@/utils/time";
import { getDayName } from "@/utils/date";
import { hoursToDecimal } from "@/utils/hours";
import { useMasters } from "@/hooks/useMasters";
import { useWorkPlans } from "@/hooks/useWorkPlans";
import PlanAddModal from "./PlanAddModal";
import WorkPlanCalendar from "./WorkPlanCalendar";
import type { Profile, WorkPlan } from "@/types";

interface WorkPlanTabProps {
  profile: Profile | null;
  profiles: Profile[];
  clients: string[];
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
  /** Org uid from the page-level header picker; empty when ORG=ALL. */
  selectedOrg?: string;
}

export default function WorkPlanTab({
  profile,
  profiles,
  clients,
  isAdmin,
  isManager,
  myName,
  selectedOrg = "",
}: WorkPlanTabProps) {
  const { plans, loading, reload: load } = useWorkPlans();
  const [selMember, setSelMember] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fClient, setFClient] = useState("");
  const [planView, setPlanView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [editRows, setEditRows] = useState<Record<string, WorkPlan>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [selectedPlan, setSelectedPlan] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const canManage = isAdmin || isManager;
  const inStyle: React.CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #2563eb",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box" as const,
  };
  const cell = {
    padding: "7px 10px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    verticalAlign: "middle",
  };

  // All employees that this manager manages (for assignment dropdown)
  const managedMembers = useMemo(() => {
    if (isAdmin)
      return profiles
        .map((p) => ({ id: p.id, name: p.full_name || "" }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    if (isManager) {
      return profiles
        .filter((p) =>
          (p.manager_ids ?? []).includes(profile?.id ?? ""),
        )
        .map((p) => ({ id: p.id, name: p.full_name || "" }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }, [profiles, profile, isAdmin, isManager]);

  const { clients: clientMasters } = useMasters();
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  // Filtered plans
  const filtered = useMemo(
    () =>
      plans.filter(
        (p) =>
          (!selMember || p.name === selMember) &&
          (!fMonth || (p.date || "").startsWith(fMonth)) &&
          (!fClient || p.client === fClient),
      ),
    [plans, selMember, fMonth, fClient],
  );

  const allMonths = [
    ...new Set(
      plans.map((p) => ((p.date as string) || "").slice(0, 7)).filter(Boolean),
    ),
  ]
    .sort()
    .reverse();
  const allClients = [
    ...new Set(plans.map((p) => p.client as string).filter(Boolean)),
  ].sort();
  const availableClients = clients;

  // Group by member for employee view
  const byMember = useMemo<Record<string, WorkPlan[]>>(() => {
    const map: Record<string, WorkPlan[]> = {};
    filtered.forEach((p) => {
      if (!map[p.name]) map[p.name] = [];
      map[p.name].push(p);
    });
    return map;
  }, [filtered]);

  // ── Add modal opener ──
  const openAddModal = () => setShowAddModal(true);

  // ── Multi-select helpers ──
  const togglePlanSelect = (id: string): void =>
    setSelectedPlan((prev) => {
      const s = new Set(prev);
      if (s.has(id)) { s.delete(id); } else { s.add(id); }
      return s;
    });

  const toggleSelectAllRows = (rows: WorkPlan[]): void => {
    const ids = rows.map((r) => r.id);
    const allSelected = ids.every((id) => selectedPlan.has(id));
    setSelectedPlan((prev) => {
      const s = new Set(prev);
      if (allSelected) ids.forEach((id) => s.delete(id));
      else ids.forEach((id) => s.add(id));
      return s;
    });
  };

  const handleBulkDeletePlan = async (): Promise<void> => {
    if (!selectedPlan.size) return;
    if (
      !window.confirm(
        `Delete ${selectedPlan.size} selected plan row${selectedPlan.size > 1 ? "s" : ""}? This cannot be undone.`,
      )
    )
      return;
    setBulkDeleting(true);
    try {
      const ids = [...selectedPlan];
      await Promise.allSettled(
        ids.map((id) => apiDelete(`/work_plans/${id}/`)),
      );
      setSelectedPlan(new Set());
      await load();
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Edit helpers ──
  const startEdit = (row: WorkPlan): void =>
    setEditRows((e) => ({ ...e, [row.id]: { ...row } }));
  const cancelEdit = (id: string): void =>
    setEditRows((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  const setEdit = (id: string, k: keyof WorkPlan, v: unknown): void =>
    setEditRows((e) => ({
      ...e,
      [id]: { ...e[id], [k]: v } as WorkPlan,
    }));

  const saveEdit = async (id: string): Promise<void> => {
    const d = editRows[id];
    if (!d.task_description?.trim()) {
      alert("Task is required.");
      return;
    }
    if (!validTime(d.hours_planned)) {
      alert("Hours must be H:MM (e.g. 2:30)");
      return;
    }
    setSaving((s) => ({ ...s, [id]: true }));
    try {
      const clientUid = d.client ? clientUidByName[d.client] : undefined;
      const body: WorkPlanUpdate = {
        date: d.date,
        task_description: d.task_description.trim(),
        planned_hours: hoursToDecimal(d.hours_planned),
        client: clientUid,
      };
      await apiPatch<WorkPlanDto>(`/work_plans/${id}/`, body);
      await load();
      cancelEdit(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
  };

  const deletePlan = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this plan entry?")) return;
    try {
      await apiDelete(`/work_plans/${id}/`);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  // ── Render table ──────────────────────────────────────────────────────────
  const renderTable = (rows: WorkPlan[], showMember = false) => {
    const allChecked =
      rows.length > 0 && rows.every((r) => selectedPlan.has(r.id));
    const someChecked = rows.some((r) => selectedPlan.has(r.id));
    const colSpan = 2 + (showMember ? 1 : 0) + 5 + (canManage ? 1 : 0);
    return (
      <div
        className="sticky-table-wrap"
        style={{ borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {/* Checkbox select-all */}
              {canManage && (
                <th
                  style={{
                    padding: "9px 8px",
                    borderBottom: "2px solid #e2e8f0",
                    width: 36,
                    textAlign: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked && !allChecked;
                    }}
                    onChange={() => toggleSelectAllRows(rows)}
                    style={{ cursor: "pointer", width: 15, height: 15 }}
                  />
                </th>
              )}
              {[
                "#",
                ...(showMember ? ["Employee"] : []),
                "Day",
                "Date",
                "Client",
                "Planned Task",
                "Planned Hours",
                ...(canManage ? ["Actions"] : []),
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "9px 10px",
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
            {/* Existing rows */}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={colSpan}
                  style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}
                >
                  {canManage
                    ? "No plans yet. Click + Add Plan to create."
                    : "No work plan assigned to you yet."}
                </td>
              </tr>
            )}
            {rows.map((row: WorkPlan, i: number) => {
              const ed = editRows[row.id];
              const isEditing = !!ed;
              const isDayOff = ["Sat", "Sun"].includes(row.day);
              const isChecked = selectedPlan.has(row.id);
              return (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    background: isChecked
                      ? "#fef3f2"
                      : isEditing
                        ? "#fffbeb"
                        : isDayOff
                          ? "#fafafa"
                          : "#fff",
                    opacity: isDayOff && !isChecked ? 0.7 : 1,
                  }}
                >
                  {/* Row checkbox */}
                  {canManage && (
                    <td style={{ ...cell, textAlign: "center", width: 36 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePlanSelect(row.id)}
                        style={{
                          cursor: "pointer",
                          width: 15,
                          height: 15,
                          accentColor: "#dc2626",
                        }}
                      />
                    </td>
                  )}
                  <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                    {i + 1}
                  </td>
                  {showMember && (
                    <td style={{ ...cell, fontWeight: 600, color: "#7c3aed" }}>
                      {row.name}
                    </td>
                  )}
                  <td
                    style={{
                      ...cell,
                      color: isDayOff ? "#ef4444" : "#64748b",
                      fontWeight: isDayOff ? 700 : 400,
                    }}
                  >
                    {isEditing ? getDayName(ed.date) : row.day}
                  </td>
                  <td style={{ ...cell, minWidth: 120 }}>
                    {isEditing ? (
                      <input
                        type="date"
                        value={ed.date}
                        onChange={(e) =>
                          setEdit(row.id, "date", e.target.value)
                        }
                        style={inStyle}
                      />
                    ) : (
                      <span style={{ color: "#475569" }}>{row.date}</span>
                    )}
                  </td>
                  <td style={{ ...cell, minWidth: 120 }}>
                    {isEditing ? (
                      <select
                        value={ed.client || ""}
                        onChange={(e) =>
                          setEdit(row.id, "client", e.target.value)
                        }
                        style={{ ...inStyle, cursor: "pointer" }}
                      >
                        <option value="">— Client —</option>
                        {availableClients.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : row.client ? (
                      <span
                        style={{
                          background: "#eff6ff",
                          color: "#2563eb",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {row.client}
                      </span>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...cell, minWidth: 250 }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={ed.task_description || ""}
                        onChange={(e) =>
                          setEdit(row.id, "task_description", e.target.value)
                        }
                        style={inStyle}
                      />
                    ) : (
                      row.task_description
                    )}
                  </td>
                  <td style={{ ...cell, minWidth: 100 }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={ed.hours_planned || ""}
                        onChange={(e) =>
                          setEdit(row.id, "hours_planned", e.target.value)
                        }
                        placeholder="H:MM"
                        maxLength={6}
                        style={{
                          ...inStyle,
                          borderColor:
                            ed.hours_planned && !validTime(ed.hours_planned)
                              ? "#dc2626"
                              : "#2563eb",
                        }}
                      />
                    ) : (
                      <span style={{ fontWeight: 700, color: "#2563eb" }}>
                        {row.hours_planned || "—"}
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveEdit(row.id)}
                            disabled={saving[row.id]}
                            style={{
                              padding: "3px 10px",
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontWeight: 600,
                              fontSize: 12,
                              marginRight: 4,
                            }}
                          >
                            {saving[row.id] ? "…" : "✓ Save"}
                          </button>
                          <button
                            onClick={() => cancelEdit(row.id)}
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
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(row)}
                            style={{
                              padding: "3px 10px",
                              border: "1px solid #e2e8f0",
                              background: "#f8fafc",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 600,
                              marginRight: 4,
                            }}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => deletePlan(row.id)}
                            style={{
                              padding: "3px 8px",
                              border: "1px solid #fecaca",
                              background: "#fff1f2",
                              color: "#dc2626",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }; // end renderTable

  const totalPlannedMins = filtered.reduce(
    (s, p) => s + toMins(p.hours_planned),
    0,
  );

  return (
    <div>
      {/* Info banner */}
      <div
        style={{
          background: canManage ? "#eff6ff" : "#f0fdf4",
          border: `1px solid ${canManage ? "#bfdbfe" : "#bbf7d0"}`,
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 14,
          fontSize: 13,
          color: canManage ? "#1e40af" : "#166534",
        }}
      >
        {canManage
          ? "📅 Create work plans for your team. Employees will see their assigned plan in this tab."
          : "📅 This is your work plan assigned by your manager. It shows your scheduled tasks by date."}
      </div>

      {/* Filters + actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "10px 12px",
          background: "#f8fafc",
          borderRadius: 8,
          alignItems: "flex-end",
        }}
      >
        {canManage && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                marginBottom: 3,
              }}
            >
              EMPLOYEE
            </div>
            <select
              value={selMember}
              onChange={(e) => setSelMember(e.target.value)}
              style={{
                padding: "6px 10px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="">All Members</option>
              {managedMembers.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            CLIENT
          </div>
          <select
            value={fClient}
            onChange={(e) => setFClient(e.target.value)}
            style={{
              padding: "6px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <option value="">All Clients</option>
            {allClients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            MONTH
          </div>
          <select
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            style={{
              padding: "6px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <option value="">All Months</option>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {(selMember || fMonth || fClient) && (
          <button
            onClick={() => {
              setSelMember("");
              setFMonth("");
              setFClient("");
              setSelectedPlan(new Set());
            }}
            style={{
              padding: "6px 10px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ✕ Clear
          </button>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#475569",
              fontWeight: 600,
              paddingBottom: 6,
            }}
          >
            {filtered.length} plans ·{" "}
            <span style={{ color: "#2563eb" }}>
              {fromMins(totalPlannedMins)} planned hrs
            </span>
          </div>
          {/* Bulk delete button */}
          {canManage && selectedPlan.size > 0 && (
            <button
              onClick={handleBulkDeletePlan}
              disabled={bulkDeleting}
              style={{
                padding: "6px 14px",
                background: bulkDeleting ? "#fca5a5" : "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: bulkDeleting ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {bulkDeleting
                ? "⏳ Deleting…"
                : `🗑 Delete Selected (${selectedPlan.size})`}
            </button>
          )}
          {/* View toggle */}
          <div
            style={{
              display: "flex",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {(
              [
                { v: "list", label: "☰ List" },
                { v: "calendar", label: "📅 Calendar" },
              ] as const
            ).map(({ v, label }) => (
              <button
                key={v}
                onClick={() => {
                  setPlanView(v);
                  setSelectedPlan(new Set());
                }}
                style={{
                  padding: "5px 12px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  background: planView === v ? "#2563eb" : "#fff",
                  color: planView === v ? "#fff" : "#475569",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {canManage && planView === "list" && (
            <button
              onClick={openAddModal}
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              + Add Plan
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>
          Loading…
        </p>
      ) : planView === "calendar" ? (
        <WorkPlanCalendar
          plans={filtered}
          calMonth={calMonth}
          setCalMonth={setCalMonth}
          allMemberNames={managedMembers.map((m) => m.name)}
        />
      ) : canManage && !selMember ? (
        // Admin/Manager — All employees grouped
        Object.keys(byMember).length === 0 ? (
          renderTable([], true)
        ) : (
          Object.entries(byMember).map(([name, rows]) => (
            <div key={name} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#7c3aed",
                  padding: "8px 4px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#7c3aed",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {name.slice(0, 2).toUpperCase()}
                </span>
                {name}
                <span
                  style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}
                >
                  — {rows.length} tasks ·{" "}
                  {fromMins(
                    rows.reduce((s, r) => s + toMins(r.hours_planned), 0),
                  )}{" "}
                  hrs
                </span>
              </div>
              {renderTable(rows, false)}
            </div>
          ))
        )
      ) : (
        // Single member selected or employee view
        renderTable(filtered, canManage && !selMember)
      )}

      {/* Add Plan Modal */}
      {showAddModal && (
        <PlanAddModal
          managedMembers={managedMembers}
          clients={clients}
          profile={profile}
          profiles={profiles}
          myName={myName}
          preselectedMember={selMember}
          selectedOrg={selectedOrg}
          onSave={() => {
            setShowAddModal(false);
            load();
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
