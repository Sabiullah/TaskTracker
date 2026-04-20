import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import {
  isOverdue,
  STATUS_CFG,
  thS,
  tdS,
  MONTH_SHORT,
  PERIODICITIES,
  getApplicableMonths,
} from "@/utils/invoice";
import { TODAY } from "@/utils/date";
import type { InvoiceEntry, InvoicePlan, MasterItem, PlanForm } from "@/types";

interface ScheduleTabProps {
  plans: InvoicePlan[];
  entries: InvoiceEntry[];
  clients: MasterItem[];
  fyMonths: string[];
  loading: boolean;
  onSavePlan: (form: PlanForm) => void;
  onDeletePlan: (id: string) => void;
  onInvoiceClick: (
    entry: InvoiceEntry | null,
    plan: InvoicePlan,
    month: string,
  ) => void;
  isAdmin: boolean;
}

export default function ScheduleTab({
  plans,
  entries,
  clients,
  fyMonths,
  loading,
  onSavePlan,
  onDeletePlan,
  onInvoiceClick,
  isAdmin,
}: ScheduleTabProps) {
  const [addRow, setAddRow] = useState<PlanForm | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlanForm>({
    client_name: "",
    job_description: "",
    periodicity: "Monthly",
    start_month: "",
    end_month: "",
    invoice_day: 1,
    base_amount: "",
  });
  const [saving, setSaving] = useState(false);

  const BLANK: PlanForm = {
    client_name: "",
    job_description: "",
    periodicity: "Monthly",
    start_month: "",
    end_month: "",
    invoice_day: 1,
    base_amount: "",
  };
  const inpS: CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #cbd5e1",
    borderRadius: 4,
    fontSize: 11,
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
  };

  const planToForm = (plan: InvoicePlan): PlanForm => ({
    id: plan.id,
    client_name: plan.client_name,
    job_description: plan.job_description,
    periodicity: plan.periodicity,
    start_month: plan.start_month ?? "",
    end_month: plan.end_month ?? "",
    invoice_day: plan.invoice_day ?? 1,
    base_amount:
      plan.base_amount !== null && plan.base_amount !== undefined
        ? String(plan.base_amount)
        : "",
  });

  const startEdit = (plan: InvoicePlan): void => {
    setEditRowId(plan.id);
    setEditForm(planToForm(plan));
    setAddRow(null);
  };
  const startAdd = (): void => {
    setAddRow({ ...BLANK });
    setEditRowId(null);
    setEditForm(BLANK);
  };
  const cancelAll = (): void => {
    setAddRow(null);
    setEditRowId(null);
    setEditForm(BLANK);
  };

  const saveRow = async (form: PlanForm): Promise<void> => {
    if (!form.client_name?.trim()) return alert("Client name required");
    if (!form.job_description?.trim()) return alert("Job description required");
    if (!form.start_month || !form.end_month)
      return alert("Start & end month required");
    if (form.start_month > form.end_month)
      return alert("Start must be before end month");
    if (!form.base_amount) return alert("Amount required");
    setSaving(true);
    await onSavePlan(form);
    setSaving(false);
    cancelAll();
  };

  /** Updater-only setter — matches both `setAddRow` and `setEditForm`. */
  type FormSetter = (next: (prev: PlanForm) => PlanForm) => void;

  /* Inline editable row — for add new or edit existing plan */
  const renderEditRow = (
    form: PlanForm,
    setForm: FormSetter,
    key: string,
  ) => (
    <tr
      key={key}
      style={{ background: "#f0f9ff", borderBottom: "2px solid #2563eb" }}
    >
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <select
          style={inpS}
          value={form.client_name || ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, client_name: e.target.value }))
          }
          autoFocus
        >
          <option value="">— Select client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <textarea
          style={{ ...inpS, minHeight: 38, resize: "vertical" }}
          value={form.job_description || ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, job_description: e.target.value }))
          }
          placeholder="Job description *"
          rows={2}
        />
      </td>
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <select
          style={inpS}
          value={form.periodicity || "Monthly"}
          onChange={(e) =>
            setForm((f) => ({ ...f, periodicity: e.target.value }))
          }
        >
          {PERIODICITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td
        style={{
          ...tdS,
          padding: "4px 6px",
          textAlign: "center",
          verticalAlign: "top",
        }}
      >
        <input
          type="number"
          style={{ ...inpS, width: 48 }}
          value={form.invoice_day || 1}
          min={1}
          max={31}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              invoice_day: Math.max(
                1,
                Math.min(31, parseInt(e.target.value) || 1),
              ),
            }))
          }
        />
      </td>
      <td
        colSpan={fyMonths.length}
        style={{ ...tdS, padding: "6px 10px", verticalAlign: "top" }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            Start Month{" "}
            <input
              type="month"
              style={{ ...inpS, width: 140 }}
              value={form.start_month || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, start_month: e.target.value }))
              }
            />
          </label>
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            End Month{" "}
            <input
              type="month"
              style={{ ...inpS, width: 140 }}
              value={form.end_month || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, end_month: e.target.value }))
              }
            />
          </label>
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            Base Amount ₹{" "}
            <input
              type="number"
              style={{ ...inpS, width: 100 }}
              value={form.base_amount || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, base_amount: e.target.value }))
              }
              placeholder="0"
              min={0}
            />
          </label>
        </div>
      </td>
      <td
        style={{
          ...tdS,
          padding: "4px 6px",
          whiteSpace: "nowrap",
          verticalAlign: "top",
        }}
      >
        <button
          onClick={() => saveRow(form)}
          disabled={saving}
          style={{
            padding: "5px 10px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            marginRight: 4,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "✓ Save"}
        </button>
        <button
          onClick={cancelAll}
          style={{
            padding: "5px 8px",
            background: "#fff",
            color: "#ef4444",
            border: "1px solid #fecaca",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );

  /* Group plans by client — one display row per client */
  const clientGroups = useMemo<Record<string, InvoicePlan[]>>(() => {
    const map: Record<string, InvoicePlan[]> = {};
    plans.forEach((p) => {
      if (!map[p.client_name]) map[p.client_name] = [];
      map[p.client_name].push(p);
    });
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => (a.serialNo || 0) - (b.serialNo || 0)),
    );
    return map;
  }, [plans]);

  /* client_name|invoice_month → array of entries */
  const clientMonthEntries = useMemo<Record<string, InvoiceEntry[]>>(() => {
    const map: Record<string, InvoiceEntry[]> = {};
    entries.forEach((e) => {
      const key = `${e.client_name}|${e.invoice_month}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [entries]);

  /* Composite status priority: Pending > Rejected > Uploaded > Approved */
  const ST_PRIORITY: Record<string, number> = {
    Pending: 0,
    Rejected: 1,
    Uploaded: 2,
    Approved: 3,
  };
  const compositeStatus = (
    monthEntries: InvoiceEntry[],
  ): InvoiceEntry | null => {
    if (!monthEntries.length) return null;
    return monthEntries.reduce(
      (w, e) => (ST_PRIORITY[e.status] <= ST_PRIORITY[w.status] ? e : w),
      monthEntries[0],
    );
  };

  const clientNames = Object.keys(clientGroups).sort();

  if (loading)
    return <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {clientNames.length} client{clientNames.length !== 1 ? "s" : ""} ·{" "}
          {plans.length} plan{plans.length !== 1 ? "s" : ""}
        </span>
        {isAdmin && !addRow && !editRowId && (
          <button
            onClick={startAdd}
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
            + Add Plan
          </button>
        )}
      </div>

      {plans.length === 0 && !addRow ? (
        <div
          style={{
            color: "#94a3b8",
            textAlign: "center",
            padding: 40,
            fontSize: 14,
          }}
        >
          No invoice plans. {isAdmin && "Click + Add Plan to begin."}
        </div>
      ) : (
        <div className="sticky-table-wrap">
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, minWidth: 140 }}>Client</th>
                <th style={{ ...thS, minWidth: 220 }}>
                  Job Description (all services)
                </th>
                <th style={{ ...thS, width: 50, textAlign: "center" }}>Day</th>
                {fyMonths.map((m, i) => (
                  <th
                    key={m}
                    style={{
                      ...thS,
                      textAlign: "center",
                      width: 68,
                      background:
                        m.slice(0, 7) === TODAY.slice(0, 7)
                          ? "#dbeafe"
                          : "#f8fafc",
                    }}
                  >
                    {MONTH_SHORT[i]}
                  </th>
                ))}
                {isAdmin && <th style={{ ...thS, minWidth: 110 }}>Plans</th>}
              </tr>
            </thead>
            <tbody>
              {clientNames.map((clientName) => {
                const clientPlans = clientGroups[clientName];

                /* If any plan in this group is being edited, show edit row */
                const editingPlan = clientPlans.find((p) => p.id === editRowId);
                if (editingPlan)
                  return renderEditRow(
                    editForm,
                    (next) => setEditForm((prev) => next(prev)),
                    clientName + "-edit",
                  );

                /* Days: show unique invoice days */
                const days = [
                  ...new Set(clientPlans.map((p) => p.invoice_day)),
                ].join(", ");

                return (
                  <tr
                    key={clientName}
                    style={{ borderBottom: "2px solid #e2e8f0" }}
                  >
                    {/* Client */}
                    <td
                      style={{ ...tdS, fontWeight: 800, verticalAlign: "top" }}
                    >
                      {clientName}
                    </td>

                    {/* Job Description — all services joined with + */}
                    <td
                      style={{
                        ...tdS,
                        verticalAlign: "top",
                        color: "#374151",
                        maxWidth: 250,
                      }}
                    >
                      {clientPlans.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && (
                            <span
                              style={{
                                color: "#94a3b8",
                                fontWeight: 700,
                                margin: "0 4px",
                              }}
                            >
                              +
                            </span>
                          )}
                          <span style={{ color: "#475569" }}>
                            {p.job_description}
                          </span>
                          <span
                            style={{
                              color: "#94a3b8",
                              fontSize: 10,
                              marginLeft: 3,
                            }}
                          >
                            ({p.periodicity})
                          </span>
                        </span>
                      ))}
                    </td>

                    {/* Invoice Day */}
                    <td
                      style={{
                        ...tdS,
                        textAlign: "center",
                        color: "#64748b",
                        verticalAlign: "top",
                      }}
                    >
                      {days}
                    </td>

                    {/* Month cells — one per FY month, grouped by client */}
                    {fyMonths.map((m) => {
                      /* Plans applicable this month for this client */
                      const applicablePlans = clientPlans.filter(
                        (p) => getApplicableMonths(p, [m]).length > 0,
                      );
                      const monthEntries =
                        clientMonthEntries[`${clientName}|${m}`] || [];
                      const hasAny = applicablePlans.length > 0;

                      /* Total amount: from entries if available, else sum of base_amounts */
                      const totalAmt =
                        monthEntries.length > 0
                          ? monthEntries.reduce(
                              (s, e) => s + Number(e.amount || 0),
                              0,
                            )
                          : applicablePlans.reduce(
                              (s, p) => s + Number(p.base_amount || 0),
                              0,
                            );

                      const hasOverdue = monthEntries.some((e) => isOverdue(e));
                      const worst = compositeStatus(monthEntries);
                      const allApproved =
                        monthEntries.length > 0 &&
                        monthEntries.every((e) => e.status === "Approved");

                      /* Descriptions applicable only this month (for tooltip + modal) */
                      const monthDesc = applicablePlans
                        .map((p) => p.job_description)
                        .join(" + ");

                      /* Primary entry for click action */
                      const primaryEntry =
                        monthEntries.find((e) =>
                          ["Pending", "Rejected"].includes(e.status),
                        ) ||
                        monthEntries.find((e) => e.status === "Uploaded") ||
                        monthEntries[0] ||
                        null;

                      /* Synthetic plan object carrying combined description */
                      const syntheticPlan = {
                        ...applicablePlans[0],
                        client_name: clientName,
                        job_description: monthDesc,
                      };

                      return (
                        <td
                          key={m}
                          style={{
                            padding: "3px 2px",
                            textAlign: "center",
                            background: hasOverdue
                              ? "#fef2f2"
                              : hasAny
                                ? "#fafafa"
                                : "transparent",
                            cursor: hasAny ? "pointer" : "default",
                            verticalAlign: "middle",
                          }}
                        >
                          {hasAny && (
                            <div
                              onClick={() =>
                                primaryEntry
                                  ? onInvoiceClick(
                                      { ...primaryEntry, amount: totalAmt },
                                      syntheticPlan,
                                      m,
                                    )
                                  : onInvoiceClick(null, syntheticPlan, m)
                              }
                              title={monthDesc}
                              style={{
                                borderRadius: 5,
                                padding: "3px 4px",
                                display: "inline-block",
                                minWidth: 64,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: hasOverdue
                                    ? "#dc2626"
                                    : allApproved
                                      ? "#16a34a"
                                      : "#1e293b",
                                }}
                              >
                                {totalAmt.toLocaleString("en-IN")}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: worst
                                    ? STATUS_CFG[worst.status]?.color
                                    : "#94a3b8",
                                }}
                              >
                                {worst ? STATUS_CFG[worst.status]?.icon : "⏳"}{" "}
                                {hasOverdue ? "⚠️" : ""}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Actions — per-plan edit/delete stacked */}
                    {isAdmin && (
                      <td
                        style={{
                          ...tdS,
                          verticalAlign: "top",
                          padding: "4px 8px",
                        }}
                      >
                        {clientPlans.map((p) => (
                          <div
                            key={p.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              marginBottom: 4,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 9,
                                color: "#94a3b8",
                                maxWidth: 55,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flexShrink: 1,
                              }}
                              title={p.job_description}
                            >
                              {p.job_description.length > 10
                                ? p.job_description.slice(0, 10) + "…"
                                : p.job_description}
                            </span>
                            <button
                              onClick={() => startEdit(p)}
                              style={{
                                padding: "2px 5px",
                                border: "1px solid #e2e8f0",
                                borderRadius: 4,
                                cursor: "pointer",
                                background: "#f8fafc",
                                fontSize: 10,
                              }}
                              title={`Edit: ${p.job_description}`}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => onDeletePlan(p.id)}
                              style={{
                                padding: "2px 5px",
                                border: "1px solid #fecaca",
                                borderRadius: 4,
                                cursor: "pointer",
                                background: "#fff1f2",
                                fontSize: 10,
                              }}
                              title={`Delete: ${p.job_description}`}
                            >
                              🗑
                            </button>
                          </div>
                        ))}
                      </td>
                    )}
                  </tr>
                );
              })}
              {/* New plan inline row appended at the bottom */}
              {addRow &&
                renderEditRow(
                  addRow,
                  (next) =>
                    setAddRow((prev) => next(prev ?? BLANK)),
                  "add-new",
                )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ────────────────────────────────────────────────────────────────
