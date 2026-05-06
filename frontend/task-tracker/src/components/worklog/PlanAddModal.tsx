import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { HolidayDto, WorkPlanCreate, WorkPlanDto } from "@/types/api";
import { useMasters } from "@/hooks/useMasters";
import { generatePlanDates } from "@/utils/plan";
import { validTime } from "@/utils/time";
import { hoursToDecimal } from "@/utils/hours";
import type { Profile } from "@/types";
import { getDayName, TODAY } from "@/utils/date";

interface PlanMember {
  id: string;
  name: string;
}

interface PlanAddModalProps {
  managedMembers: PlanMember[];
  clients: string[];
  profile?: Profile | null;
  profiles: Profile[];
  myName?: string;
  preselectedMember?: string;
  /** Header-level org filter (uid) — when set, every plan row is created in
   *  this org. When empty (e.g. ORG=ALL) the assignee's own org is used so
   *  multi-org callers don't get rejected by ``resolve_create_org``. */
  selectedOrg?: string;
  onSave: () => void;
  onClose: () => void;
}

export default function PlanAddModal({
  managedMembers,
  clients,
  profiles,
  preselectedMember,
  selectedOrg = "",
  onSave,
  onClose,
}: PlanAddModalProps) {
  const { clients: clientMasters } = useMasters();
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);
  const defaultEnd = () => {
    // Default end ≈ 2 months from today (last day of that month) so the date
    // picker has a sensible value when the user switches to recurring.
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const y = last.getFullYear();
    const m = String(last.getMonth() + 1).padStart(2, "0");
    const day = String(last.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const [selEmps, setSelEmps] = useState(
    preselectedMember ? [preselectedMember] : [],
  );
  const [empSearch, setEmpSearch] = useState("");
  const [date, setDate] = useState(TODAY);
  const [client, setClient] = useState("");
  const [task, setTask] = useState("");
  const [hours, setHours] = useState("");
  const [recur, setRecur] = useState("onetime");
  const [endDate, setEndDate] = useState(defaultEnd);
  const [holidayDates, setHolidayDates] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [saving, setSaving] = useState(false);

  // Holidays drive the Daily-recurrence skip list. Fetch once when the modal
  // opens — Sundays are skipped purely from the weekday, so this is only
  // needed to honour the company holiday calendar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dtos = await apiGet<HolidayDto[]>("/holidays/");
        if (cancelled) return;
        setHolidayDates(new Set(dtos.map((h) => h.date)));
      } catch {
        // Non-fatal — Daily recurrence still works, holidays just won't be
        // skipped automatically. The user can delete generated rows later.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleEmp = (name: string): void =>
    setSelEmps((p) =>
      p.includes(name) ? p.filter((n) => n !== name) : [...p, name],
    );

  const filteredEmps = managedMembers.filter(
    (m: PlanMember) =>
      !empSearch || m.name.toLowerCase().includes(empSearch.toLowerCase()),
  );

  const dates = generatePlanDates(
    date,
    recur,
    endDate,
    recur === "daily" ? holidayDates : undefined,
  );
  const totalRows = selEmps.length * dates.length;
  const needsEndDate =
    recur === "weekly" || recur === "monthly" || recur === "daily";

  const handleSave = async (): Promise<void> => {
    if (!selEmps.length) {
      alert("Select at least one employee.");
      return;
    }
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
    if (totalRows > 500) {
      alert(
        `Too many rows (${totalRows}). Reduce the date range or employees.`,
      );
      return;
    }
    setSaving(true);
    try {
      const clientUid = client ? clientUidByName[client] : undefined;
      const hoursStr = hours ? hoursToDecimal(hours) : "0.00";
      const bodies: WorkPlanCreate[] = [];
      const missingOrg: string[] = [];
      for (const empName of selEmps) {
        const emp = profiles.find((p) => p.full_name === empName);
        if (!emp) continue;
        // The modal has no org picker (mirrors Categories — see
        // ``MastersPage`` fix). Multi-org callers used to hit a 400 from
        // ``resolve_create_org`` because ``org`` was never sent. Resolve it
        // here: header filter wins, else the assignee's default/first org.
        const empDefaultOrg =
          emp.orgs.find((o) => o.is_default) ?? emp.orgs[0];
        const orgUid = selectedOrg || empDefaultOrg?.uid;
        if (!orgUid) {
          missingOrg.push(empName);
          continue;
        }
        for (const d of dates) {
          bodies.push({
            assigned_to: emp.id,
            date: d,
            task_description: task.trim(),
            planned_hours: hoursStr,
            client: clientUid,
            org: orgUid,
          });
        }
      }
      if (missingOrg.length) {
        // Defensive guard: ``resolve_create_org`` 400s if no org is sent and
        // the caller is multi-org. Tell the user how to unblock instead of
        // silently submitting a request the backend will reject.
        alert(
          `Cannot determine an organisation for: ${missingOrg.join(", ")}.\n` +
            `Pick an organisation from the header (top-right) and try again.`,
        );
        setSaving(false);
        return;
      }
      const results = await Promise.allSettled(
        bodies.map((body) => apiPost<WorkPlanDto>("/work_plans/", body)),
      );
      const failed: PromiseRejectedResult[] = results.flatMap((r) =>
        r.status === "rejected" ? [r] : [],
      );
      if (failed.length) {
        // Surface the first server message so multi-row failures don't all
        // collapse into a useless "1 row(s) failed to save." Helpful for
        // missing-org / 403 / validation cases the modal can't pre-detect.
        const firstReason = failed[0].reason;
        const detail =
          firstReason instanceof ApiError
            ? firstReason.message
            : String(firstReason);
        alert(`${failed.length} plan row(s) failed to save.\n\n${detail}`);
      }
      onSave();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const inS: CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
    fontFamily: "inherit",
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
      onClick={onClose}
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
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b" }}>
            📅 Add Work Plan
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
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
          {/* ── Employee multi-select ── */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                marginBottom: 6,
              }}
            >
              EMPLOYEES <span style={{ color: "#ef4444" }}>*</span>
              <span
                style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}
              >
                Select one or more
              </span>
            </div>
            <input
              type="text"
              placeholder="🔍 Search employees…"
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
              style={{ ...inS, marginBottom: 8, borderColor: "#e2e8f0" }}
            />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 7,
                maxHeight: 130,
                overflowY: "auto",
                padding: "2px 2px 4px",
              }}
            >
              {filteredEmps.map((m) => {
                const checked = selEmps.includes(m.name);
                return (
                  <label
                    key={m.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 20,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      border: `1.5px solid ${checked ? "#2563eb" : "#e2e8f0"}`,
                      background: checked ? "#eff6ff" : "#f8fafc",
                      color: checked ? "#2563eb" : "#475569",
                      transition: "all .12s",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEmp(m.name)}
                      style={{
                        accentColor: "#2563eb",
                        width: 13,
                        height: 13,
                        cursor: "pointer",
                      }}
                    />
                    {m.name}
                  </label>
                );
              })}
              {filteredEmps.length === 0 && (
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  No employees found.
                </span>
              )}
            </div>
            {selEmps.length > 0 && (
              <div
                style={{
                  marginTop: 7,
                  fontSize: 12,
                  color: "#16a34a",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ✅ {selEmps.length} selected:
                <span style={{ fontWeight: 400, color: "#374151" }}>
                  {selEmps.join(" · ")}
                </span>
              </div>
            )}
          </div>

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
                {[
                  ["onetime", "1× One-time"],
                  ["daily", "☀️ Daily"],
                  ["weekly", "🔁 Weekly"],
                  ["monthly", "📆 Monthly"],
                ].map(([v, l]) => (
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
                {clients.map((c) => (
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

          {/* ── Summary ── */}
          {selEmps.length > 0 && task.trim() && (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#1e40af",
                fontWeight: 600,
              }}
            >
              💾 Will create&nbsp;<strong>{totalRows}</strong>&nbsp;plan row
              {totalRows !== 1 ? "s" : ""}
              &nbsp;({selEmps.length} employee{selEmps.length !== 1 ? "s" : ""}{" "}
              × {dates.length} date{dates.length !== 1 ? "s" : ""})
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
            style={{
              padding: "8px 20px",
              border: "1px solid #e2e8f0",
              borderRadius: 7,
              cursor: "pointer",
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
            disabled={saving || !selEmps.length || !task.trim()}
            style={{
              padding: "8px 22px",
              background: saving ? "#93c5fd" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              fontWeight: 700,
              fontSize: 13,
              cursor:
                saving || !selEmps.length || !task.trim()
                  ? "not-allowed"
                  : "pointer",
              opacity: !selEmps.length || !task.trim() ? 0.6 : 1,
              transition: "all .12s",
            }}
          >
            {saving
              ? `⏳ Saving ${totalRows} rows…`
              : `✓ Save ${totalRows > 0 ? totalRows + " " : ""}Plan Row${totalRows !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Work Plan Calendar View ───────────────────────────────────────────────────
