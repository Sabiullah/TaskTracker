import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { WorkPlan } from "@/types";
import type { WorkPlanRecurrenceValue } from "@/types/api";
import { generatePlanDates } from "@/utils/plan";
import { validTime } from "@/utils/time";
import { getDayName } from "@/utils/date";

export type EditScope = "this" | "following";

interface PlanEditModalProps {
  /** The row being edited. Provides all initial values. */
  row: WorkPlan;
  /** Active client name list (already filtered by parent). */
  clients: string[];
  /** Map from client name → master uid. Parent owns the lookup. */
  clientUidByName: Record<string, string>;
  saving: boolean;
  /** Called on save with the chosen scope (only relevant for series rows). */
  onSave: (input: PlanEditSaveInput) => void;
  onClose: () => void;
}

export interface PlanEditSaveInput {
  date: string; // YYYY-MM-DD
  recurrence: WorkPlanRecurrenceValue; // "" | "daily" | "weekly" | "monthly"
  recurrence_end_date: string | null; // YYYY-MM-DD when recurrence !== ""
  client: string | null; // client name; null = cleared
  hours_planned: string; // H:MM
  task_description: string;
  scope: EditScope | null; // null for one-time rows (no scope choice)
}

// Internal recurrence value used in the form. The 4-button picker uses
// "onetime" to mean "no recurrence" — same as PlanAddModal. We map back
// to the wire shape (`""`) when calling onSave.
type RecurUi = "onetime" | "daily" | "weekly" | "monthly";

const toRecurUi = (r: WorkPlan["recurrence"]): RecurUi =>
  r === "" ? "onetime" : r;

const toRecurWire = (r: RecurUi): WorkPlanRecurrenceValue =>
  r === "onetime" ? "" : r;

const defaultEnd = (start: string): string => {
  // Default end ≈ 2 months from the start date (last day of that month) so
  // the date picker has a sensible value when the user switches an existing
  // one-time row to a recurring cadence. Mirrors PlanAddModal.defaultEnd
  // but anchored to the row's start instead of "today".
  const base = start ? new Date(start + "T00:00:00") : new Date();
  base.setMonth(base.getMonth() + 2);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const y = last.getFullYear();
  const m = String(last.getMonth() + 1).padStart(2, "0");
  const day = String(last.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export default function PlanEditModal({
  row,
  clients,
  // Parent owns the name → uid lookup; the modal surfaces the client *name*
  // back to the caller and lets the parent resolve the UID before calling
  // the API. We keep the prop in the interface so the eventual WorkPlanTab
  // wiring (Task C) passes the same shape it already builds for other
  // worklog modals — rename to `_` to satisfy the unused-vars lint.
  clientUidByName: _clientUidByName,
  saving,
  onSave,
  onClose,
}: PlanEditModalProps) {
  const [date, setDate] = useState<string>(row.date);
  const [recur, setRecur] = useState<RecurUi>(toRecurUi(row.recurrence));
  const [endDate, setEndDate] = useState<string>(
    row.recurrence_end_date ?? defaultEnd(row.date),
  );
  const [client, setClient] = useState<string>(row.client ?? "");
  const [hours, setHours] = useState<string>(row.hours_planned ?? "");
  const [task, setTask] = useState<string>(row.task_description ?? "");
  // Default to "following" per spec — most edits to a series row should
  // propagate. One-time rows don't render the picker (scope passed as null).
  const [scope, setScope] = useState<EditScope>("following");

  const isSeriesRow = Boolean(row.series_uid);
  const needsEndDate = recur !== "onetime";

  // Mirror PlanAddModal: no holiday set is passed when calling from this
  // component. The modal display matches the Add modal's behaviour when one
  // isn't supplied. (Backend reshape doesn't holiday-filter either — see
  // spec §9.4.)
  const dates = useMemo(
    () => generatePlanDates(date, recur, endDate),
    [date, recur, endDate],
  );

  // Defensive: if the parent supplies a non-empty current client name that
  // isn't in the active list (e.g. it was deactivated since), keep it in
  // the dropdown so the user doesn't see a phantom "blank" selection.
  const clientOptions = useMemo(() => {
    if (!client || clients.includes(client)) return clients;
    return [client, ...clients];
  }, [client, clients]);

  const inS: CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const handleSave = (): void => {
    if (!task.trim()) {
      alert("Task description is required.");
      return;
    }
    if (!validTime(hours)) {
      alert("Hours must be H:MM format (e.g. 2:30)");
      return;
    }
    if (needsEndDate && !endDate) {
      alert("Select an end date.");
      return;
    }
    if (needsEndDate && endDate && endDate < date) {
      alert("End date must be on or after the start date.");
      return;
    }
    if (needsEndDate && dates.length === 0) {
      alert("No working dates between the start and end date.");
      return;
    }
    const recurrence = toRecurWire(recur);
    // `clientUidByName` is owned by the parent; surface the lookup result
    // back to the caller as the client *name* (mirrors what the row stores).
    // The wire-level client UID is the parent's responsibility on save.
    const clientName = client || null;
    onSave({
      date,
      recurrence,
      recurrence_end_date: recurrence === "" ? null : endDate,
      client: clientName,
      hours_planned: hours,
      task_description: task.trim(),
      scope: isSeriesRow ? scope : null,
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4000,
      }}
      onClick={saving ? undefined : onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "min(660px,96vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,.32)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexShrink: 0,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b" }}>
              📝 Edit Work Plan
            </span>
            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
              Employee: <span style={{ color: "#64748b" }}>{row.name}</span>
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: saving ? "not-allowed" : "pointer",
              color: "#94a3b8",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* ── Date + Recurrence ── */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 5,
                }}
              >
                START DATE <span style={{ color: "#ef4444" }}>*</span>
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={inS}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                {getDayName(date)}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 5,
                }}
              >
                RECURRENCE
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(
                  [
                    ["onetime", "1× One-time"],
                    ["daily", "☀️ Daily"],
                    ["weekly", "🔁 Weekly"],
                    ["monthly", "📆 Monthly"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setRecur(v)}
                    style={{
                      flex: 1,
                      minWidth: 78,
                      padding: "7px 4px",
                      border: `1.5px solid ${recur === v ? "#2563eb" : "#e2e8f0"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      background: recur === v ? "#eff6ff" : "#fff",
                      color: recur === v ? "#2563eb" : "#64748b",
                      transition: "all .12s",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── End date (daily / weekly / monthly) ── */}
          {needsEndDate && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#15803d",
                  marginBottom: 8,
                }}
              >
                {recur === "daily"
                  ? "☀️ Repeats every day · Sundays and holidays are skipped"
                  : recur === "weekly"
                    ? "🔁 Repeats every week on the same day of week"
                    : "📆 Repeats every month on the same date"}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}
                >
                  End date <span style={{ color: "#ef4444" }}>*</span>:
                </div>
                <input
                  type="date"
                  value={endDate}
                  min={date}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    border: "1.5px solid #86efac",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
                {endDate && (
                  <span style={{ fontSize: 11, color: "#15803d" }}>
                    {getDayName(endDate)}
                  </span>
                )}
              </div>
              {endDate && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#15803d",
                    marginTop: 8,
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}
                >
                  📋 <strong>{dates.length}</strong> date
                  {dates.length !== 1 ? "s" : ""} will be created:&nbsp;
                  <span style={{ fontWeight: 400 }}>
                    {dates
                      .slice(0, 6)
                      .map((d) => `${d} (${getDayName(d)})`)
                      .join(", ")}
                    {dates.length > 6 ? ` … +${dates.length - 6} more` : ""}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Client + Hours ── */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 5,
                }}
              >
                CLIENT
              </div>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                style={{ ...inS, cursor: "pointer" }}
              >
                <option value="">— Select Client —</option>
                {clientOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 5,
                }}
              >
                PLANNED HOURS
              </div>
              <input
                type="text"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="H:MM  e.g. 3:00"
                maxLength={6}
                style={{
                  ...inS,
                  borderColor:
                    hours && !validTime(hours) ? "#dc2626" : "#e2e8f0",
                }}
              />
              {hours && !validTime(hours) && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>
                  Use H:MM format
                </div>
              )}
            </div>
          </div>

          {/* ── Task ── */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                marginBottom: 5,
              }}
            >
              TASK / VISIT DESCRIPTION{" "}
              <span style={{ color: "#ef4444" }}>*</span>
            </div>
            <input
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Client visit, Financial audit, Template review…"
              style={inS}
            />
          </div>

          {/* ── Scope (series rows only) ── */}
          {isSeriesRow && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 8,
                }}
              >
                Apply this edit to:
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#1e293b",
                }}
              >
                <input
                  type="radio"
                  name="edit-scope"
                  value="this"
                  checked={scope === "this"}
                  onChange={() => setScope("this")}
                  style={{ accentColor: "#2563eb" }}
                />
                This entry only
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "4px 0",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#1e293b",
                }}
              >
                <input
                  type="radio"
                  name="edit-scope"
                  value="following"
                  checked={scope === "following"}
                  onChange={() => setScope("following")}
                  style={{ accentColor: "#2563eb", marginTop: 3 }}
                />
                <span>
                  This and following entries
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      marginTop: 2,
                      fontWeight: 400,
                    }}
                  >
                    Future entries in this series will be updated. Recurrence
                    changes will re-materialize them.
                  </div>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            background: "#f8fafc",
            borderRadius: "0 0 14px 14px",
          }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "8px 20px",
              border: "1px solid #e2e8f0",
              borderRadius: 7,
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 13,
              background: "#fff",
              color: "#475569",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !task.trim()}
            style={{
              padding: "8px 22px",
              background: saving ? "#93c5fd" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              fontWeight: 700,
              fontSize: 13,
              cursor: saving || !task.trim() ? "not-allowed" : "pointer",
              opacity: !task.trim() ? 0.6 : 1,
              transition: "all .12s",
            }}
          >
            {saving ? "⏳ Saving…" : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
