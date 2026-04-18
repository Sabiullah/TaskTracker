import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { formatMonthLabel as fmtMonth } from "@/utils/date";
import { thS, tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import type { Profile } from "@/types";
import type {
  GrowthPlanCreate,
  GrowthPlanDto,
  GrowthPlanStatusValue,
  GrowthPlanUpdate,
} from "@/types/api";
import {
  BLANK_PLAN_ROW as BLANK,
  PRIORITY_CFG,
  STATUSES,
  STATUS_CFG,
  dtoToPlanRow as dtoToRow,
} from "@/utils/growthplan";
import type { PlanRow } from "@/types/growthplan";
import EditRow from "@/components/growthplan/EditRow";

interface GrowthPlanPageProps {
  profile: Profile | null;
  profiles: Profile[];
}

// GrowthPlan rows use verticalAlign: "top" for multi-line notes cells.
const tdS: CSSProperties = { ...sharedTdS, verticalAlign: "top" };

export default function GrowthPlanPage({
  profiles,
}: GrowthPlanPageProps) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState<PlanRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlanRow>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState<GrowthPlanStatusValue | "">("");
  const [fMonth, setFMonth] = useState("");
  const [fSearch, setFSearch] = useState("");

  const memberOptions = useMemo(
    () =>
      (profiles || [])
        .map((p) => p.full_name)
        .filter(Boolean)
        .sort(),
    [profiles],
  );

  const uidByName = useMemo(() => {
    const map: Record<string, string> = {};
    (profiles || []).forEach((p) => {
      if (p.full_name) map[p.full_name] = p.id;
    });
    return map;
  }, [profiles]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const dtos = await apiGet<GrowthPlanDto[]>("/growth_plans/");
      setPlans(dtos.map(dtoToRow));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<GrowthPlanDto>("growth-plans", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const months = useMemo(
    () =>
      [...new Set(plans.map((p) => p.target_month).filter(Boolean))].sort(),
    [plans],
  );

  const filtered = useMemo(
    () =>
      plans
        .filter((p) => !fStatus || p.status === fStatus)
        .filter((p) => !fMonth || p.target_month === fMonth)
        .filter((p) => {
          if (!fSearch) return true;
          const q = fSearch.toLowerCase();
          return (
            p.activity.toLowerCase().includes(q) ||
            p.steps_taken.toLowerCase().includes(q) ||
            p.steps_to_take.toLowerCase().includes(q) ||
            p.assigned_to.toLowerCase().includes(q) ||
            p.remarks.toLowerCase().includes(q)
          );
        }),
    [plans, fStatus, fMonth, fSearch],
  );

  const stats = useMemo(
    () => ({
      total: plans.length,
      open: plans.filter((p) => p.status === "Open").length,
      inProgress: plans.filter((p) => p.status === "Under Progress").length,
      completed: plans.filter((p) => p.status === "Completed").length,
      onHold: plans.filter((p) => p.status === "On Hold").length,
    }),
    [plans],
  );

  const validateForm = (form: PlanRow): boolean => {
    if (!form.activity?.trim()) {
      alert("Activity is required");
      return false;
    }
    if (!form.target_month) {
      alert("Target month is required");
      return false;
    }
    return true;
  };

  const handleSave = async (
    form: PlanRow,
    id?: string | null,
  ): Promise<void> => {
    if (!validateForm(form)) return;
    setSaving(true);
    try {
      const assignedUid = form.assigned_to
        ? uidByName[form.assigned_to]
        : undefined;
      // Form input is ``<input type="month">`` (``YYYY-MM``); Django's
      // DateField rejects that shape and needs ``YYYY-MM-DD``. Append
      // day-1 before sending so PATCH/POST doesn't 400.
      const targetMonth =
        form.target_month && form.target_month.length === 7
          ? `${form.target_month}-01`
          : form.target_month;
      const body: GrowthPlanCreate = {
        activity: form.activity.trim(),
        target_month: targetMonth,
        steps_taken: form.steps_taken?.trim() || undefined,
        steps_to_take: form.steps_to_take?.trim() || undefined,
        status: form.status,
        priority: form.priority,
        assigned_to: assignedUid,
        remarks: form.remarks?.trim() || undefined,
      };
      if (id) {
        const patch: GrowthPlanUpdate = body;
        await apiPatch<GrowthPlanDto>(`/growth_plans/${id}/`, patch);
      } else {
        await apiPost<GrowthPlanDto>("/growth_plans/", body);
      }
      setAddRow(null);
      setEditId(null);
      setEditForm(BLANK);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this growth plan entry?")) return;
    setDeleting(id);
    try {
      await apiDelete(`/growth_plans/${id}/`);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  };

  const startEdit = (p: PlanRow): void => {
    setEditId(p.id);
    setEditForm({ ...p });
    setAddRow(null);
  };
  const cancelAll = (): void => {
    setEditId(null);
    setEditForm(BLANK);
    setAddRow(null);
  };
  const clearFilters = (): void => {
    setFStatus("");
    setFMonth("");
    setFSearch("");
  };
  const hasFilter = fStatus || fMonth || fSearch;

  const handleExportCSV = (): void => {
    const headers = [
      "#",
      "Activity",
      "Target Month",
      "Steps Taken",
      "Steps To Take",
      "Priority",
      "Assigned To",
      "Status",
      "Remarks",
    ];
    const rows = filtered.map((p, i) => [
      i + 1,
      `"${p.activity.replace(/"/g, '""')}"`,
      p.target_month,
      `"${p.steps_taken.replace(/"/g, '""')}"`,
      `"${p.steps_to_take.replace(/"/g, '""')}"`,
      p.priority,
      p.assigned_to,
      p.status,
      `"${p.remarks.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `growth-plans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center",
  });

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div className="page-title">📈 Company Growth Plan</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleExportCSV}
            style={{
              padding: "7px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ⬇ Export CSV
          </button>
          {!addRow && !editId && (
            <button
              onClick={() => {
                setAddRow({ ...BLANK });
                setEditId(null);
              }}
              style={{
                padding: "7px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 7,
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

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div className="dm-stat-card" style={cardS("#2563eb")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb" }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Total
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#dc2626")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
            {stats.open}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Open
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#d97706")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#d97706" }}>
            {stats.inProgress}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            In Progress
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#16a34a")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#16a34a" }}>
            {stats.completed}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Completed
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#7c3aed")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed" }}>
            {stats.onHold}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            On Hold
          </div>
        </div>
      </div>

      <div
        className="dm-filter-bar"
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          border: "1px solid #e2e8f0",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Search…"
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          style={{ ...inpS, maxWidth: 200 }}
        />
        <select
          style={{ ...inpS, maxWidth: 150 }}
          value={fStatus}
          onChange={(e) =>
            setFStatus(e.target.value as GrowthPlanStatusValue | "")
          }
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          style={{ ...inpS, maxWidth: 150 }}
          value={fMonth}
          onChange={(e) => setFMonth(e.target.value)}
        >
          <option value="">All Months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(m)}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={clearFilters}
            style={{
              padding: "4px 10px",
              background: "#fee2e2",
              color: "#dc2626",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ✕ Clear
          </button>
        )}
        <span
          style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}
        >
          {filtered.length} of {plans.length} plans
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Loading…
        </div>
      ) : (
        <div
          className="sticky-table-wrap dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, minWidth: 200 }}>Activity</th>
                <th style={{ ...thS, width: 110 }}>Target Month</th>
                <th style={{ ...thS, minWidth: 180 }}>Steps Taken</th>
                <th style={{ ...thS, minWidth: 180 }}>Steps To Take</th>
                <th style={{ ...thS, width: 80 }}>Priority</th>
                <th style={{ ...thS, width: 110 }}>Assigned To</th>
                <th style={{ ...thS, width: 120 }}>Status</th>
                <th style={{ ...thS, minWidth: 120 }}>Remarks</th>
                <th style={{ ...thS, width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {addRow && (
                <EditRow
                  form={addRow}
                  setForm={
                    setAddRow as unknown as Dispatch<SetStateAction<PlanRow>>
                  }
                  isNew
                  onSave={() => {
                    void handleSave(addRow);
                  }}
                  onCancel={cancelAll}
                  saving={saving}
                  memberOptions={memberOptions}
                />
              )}

              {filtered.length === 0 && !addRow && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 30,
                      color: "#94a3b8",
                    }}
                  >
                    No growth plans found. Click &quot;+ Add Plan&quot; to create
                    one.
                  </td>
                </tr>
              )}

              {filtered.map((p, i) => {
                if (editId === p.id) {
                  return (
                    <EditRow
                      key={p.id}
                      form={editForm}
                      setForm={setEditForm}
                      isNew={false}
                      onSave={() => {
                        void handleSave(editForm, p.id);
                      }}
                      onCancel={cancelAll}
                      saving={saving}
                      memberOptions={memberOptions}
                    />
                  );
                }
                const sc = STATUS_CFG[p.status];
                const pc = PRIORITY_CFG[p.priority];
                return (
                  <tr
                    key={p.id}
                    style={{ transition: "background .12s" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "")
                    }
                  >
                    <td
                      style={{
                        ...tdS,
                        color: "#94a3b8",
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{
                        ...tdS,
                        fontWeight: 600,
                        color: "#1e293b",
                      }}
                    >
                      {p.activity}
                    </td>
                    <td style={{ ...tdS, fontSize: 12 }}>
                      {fmtMonth(p.target_month)}
                    </td>
                    <td
                      style={{
                        ...tdS,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.5,
                      }}
                    >
                      {p.steps_taken || "—"}
                    </td>
                    <td
                      style={{
                        ...tdS,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.5,
                      }}
                    >
                      {p.steps_to_take || "—"}
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 700,
                          background: pc.bg,
                          color: pc.color,
                        }}
                      >
                        {p.priority}
                      </span>
                    </td>
                    <td style={{ ...tdS, fontSize: 12 }}>
                      {p.assigned_to || "—"}
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 700,
                          background: sc.bg,
                          color: sc.color,
                        }}
                      >
                        {sc.icon} {p.status}
                      </span>
                    </td>
                    <td
                      style={{ ...tdS, fontSize: 12, color: "#64748b" }}
                    >
                      {p.remarks || "—"}
                    </td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => startEdit(p)}
                        title="Edit"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 4px",
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => {
                          void handleDelete(p.id);
                        }}
                        title="Delete"
                        disabled={deleting === p.id}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 4px",
                          opacity: deleting === p.id ? 0.5 : 1,
                        }}
                      >
                        🗑️
                      </button>
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
