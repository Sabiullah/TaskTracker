import { useMemo, useState, type CSSProperties } from "react";
import {
  STATUSES,
  STATUS_CFG,
  BLANK,
  inpS,
} from "@/utils/attendance";
import { computeWorkedHours, fmtClockTime } from "@/utils/time";
import { TODAY, fmtDate, localDateStr } from "@/utils/date";
import AttendanceLogTab from "@/components/attendance/AttendanceLogTab";
import AttendanceReportTab from "@/components/attendance/AttendanceReportTab";
import type { AttendanceRecord, Profile } from "@/types";
import { useAttendance } from "@/hooks/useAttendance";

import { useAuth } from "@/hooks/useAuth";

interface AttendancePageProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
}

type SubTab = "log" | "report";

export default function AttendancePage({
  profile,
  profiles = [],
}: AttendancePageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const {
    records,
    loading,
    reload,
    saveRecord,
    deleteRecord,
    quickPunch,
    backdateDays,
    backdateLoaded,
    saveBackdateSetting,
    managedNames,
  } = useAttendance(profile, profiles);

  const [addRow, setAddRow] = useState<Partial<AttendanceRecord> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<AttendanceRecord>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("log");
  const [fMember, setFMember] = useState("");
  const [fMonth, setFMonth] = useState(() => TODAY.slice(0, 7));
  const [fStatus, setFStatus] = useState("");

  const isAdmin = isAdminInAny();
  const isManager = (isManagerInAny() && !isAdminInAny());
  const myName = profile?.full_name ?? "";

  const visibleMembers = useMemo(() => {
    const all = profiles
      .map((p) => p.full_name)
      .filter(Boolean)
      .sort();
    if (isAdmin) return all;
    if (isManager) return [myName, ...managedNames].sort();
    return [myName];
  }, [isAdmin, isManager, myName, managedNames, profiles]);

  const minBackdate = useMemo(() => {
    if (backdateDays < 0) return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - backdateDays);
    return localDateStr(d);
  }, [backdateDays]);

  const filtered = useMemo(
    () =>
      records
        .filter((r) => !fMember || r.employee_name === fMember)
        .filter((r) => !fMonth || (r.date ?? "").startsWith(fMonth))
        .filter((r) => !fStatus || r.status === fStatus),
    [records, fMember, fMonth, fStatus],
  );

  const stats = useMemo(
    () => ({
      total: filtered.length,
      present: filtered.filter((r) => r.status === "Present").length,
      absent: filtered.filter((r) => r.status === "Absent").length,
      halfDay: filtered.filter((r) => r.status === "Half Day").length,
      leave: filtered.filter((r) => r.status === "Leave").length,
      wfh: filtered.filter((r) => r.work_location === "WFH").length,
    }),
    [filtered],
  );

  const todayRecord = records.find(
    (r) => r.employee_name === myName && r.date === TODAY,
  );

  const checkBackdate = (
    dateStr: string | null | undefined,
  ): string | null => {
    if (backdateDays < 0 || !dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const entry = new Date(dateStr);
    entry.setHours(0, 0, 0, 0);
    if (isNaN(entry.getTime()) || entry.getTime() >= today.getTime())
      return null;
    const diff = Math.floor(
      (today.getTime() - entry.getTime()) / 86400000,
    );
    if (diff <= backdateDays) return null;
    if (backdateDays === 0)
      return `Backdated entries are not allowed. Only today's date is accepted.${isAdmin ? " Change the Backdate dropdown to relax the restriction." : ""}`;
    return `This entry is ${diff} day(s) in the past, but the current rule allows only up to ${backdateDays} day(s).${isAdmin ? " Change the Backdate dropdown." : ""}`;
  };

  const handleSave = async (
    form: Partial<AttendanceRecord>,
    id?: string | null,
  ): Promise<void> => {
    if ((isAdmin || isManager) && !form.employee_name?.trim()) {
      alert("Employee name is required");
      return;
    }
    if (!form.date) {
      alert("Date is required");
      return;
    }
    if (!form.status) {
      alert("Status is required");
      return;
    }
    if (!isAdmin) {
      const err = checkBackdate(form.date);
      if (err) {
        alert(err);
        return;
      }
    }
    setSaving(true);
    try {
      await saveRecord(form, id ?? null);
      setAddRow(null);
      setEditId(null);
      setEditForm({});
      await reload();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setDeleting(id);
    try {
      await deleteRecord(id);
    } finally {
      setDeleting(null);
    }
  };

  const handleExportCSV = (): void => {
    const headers = [
      "#",
      "Employee",
      "Date",
      "Day",
      "Login",
      "Logout",
      "Hours",
      "Location",
      "Status",
      "Remarks",
    ];
    const rows = filtered.map((r, i) => {
      const hrs = r.total_hours ?? computeWorkedHours(r.login_time, r.logout_time);
      return [
        i + 1,
        r.employee_name || "",
        r.date || "",
        new Date((r.date ?? "") + "T00:00:00").toLocaleDateString("en-GB", {
          weekday: "short",
        }),
        fmtClockTime(r.login_time),
        fmtClockTime(r.logout_time),
        hrs != null ? hrs.toFixed(2) : "",
        r.work_location || "",
        r.status || "",
        `"${(r.remarks || "").replace(/"/g, '""')}"`,
      ];
    });
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n",
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${fMonth || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const backdateLabel =
    backdateDays < 0
      ? "No limit"
      : backdateDays === 0
        ? "Today only"
        : backdateDays === 1
          ? "1 day"
          : `${backdateDays} days`;
  const hasFilter = fMember || fStatus || fMonth !== TODAY.slice(0, 7);

  const punchBtnStyle: CSSProperties = {
    padding: "8px 18px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    background:
      todayRecord && !todayRecord.logout_time ? "#dc2626" : "#16a34a",
    color: "#fff",
  };

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="page-title">
          🕐 {isAdmin ? "Team Attendance" : "My Attendance"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => {
              void quickPunch();
            }}
            style={punchBtnStyle}
          >
            {todayRecord
              ? todayRecord.logout_time
                ? "✅ Punched Out"
                : "🔴 Punch Out"
              : "🟢 Punch In"}
          </button>
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
          {(isAdmin || isManager) && !addRow && !editId && (
            <button
              onClick={() => {
                setAddRow({ ...BLANK, employee_name: isAdmin ? "" : myName });
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
              + Add Record
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div
        className="wl-subtab-bar"
        style={{
          display: "flex",
          gap: 6,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          marginBottom: 12,
          width: "fit-content",
        }}
      >
        {(
          [
            ["log", "📋 Attendance Log"],
            ["report", "📊 Report"],
          ] as const
        ).map(([id, lbl]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: subTab === id ? "#fff" : "transparent",
              color: subTab === id ? "#1e293b" : "#64748b",
              boxShadow: subTab === id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {[
          { label: "Total", val: stats.total, color: "#2563eb" },
          { label: "Present", val: stats.present, color: "#16a34a" },
          { label: "Absent", val: stats.absent, color: "#dc2626" },
          { label: "Half Day", val: stats.halfDay, color: "#d97706" },
          { label: "Leave", val: stats.leave, color: "#7c3aed" },
          { label: "WFH", val: stats.wfh, color: "#0891b2" },
        ].map((s) => (
          <div
            key={s.label}
            className="dm-stat-card"
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "8px 16px",
              borderTop: `3px solid ${s.color}`,
              boxShadow: "0 1px 4px rgba(0,0,0,.07)",
              minWidth: 80,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>
              {s.val}
            </div>
            <div
              style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
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
        {(isAdmin || isManager) && (
          <select
            style={{ ...inpS, maxWidth: 150 }}
            value={fMember}
            onChange={(e) => setFMember(e.target.value)}
          >
            <option value="">All Employees</option>
            {visibleMembers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <input
          type="month"
          style={{ ...inpS, maxWidth: 150 }}
          value={fMonth}
          onChange={(e) => setFMonth(e.target.value)}
        />
        <select
          style={{ ...inpS, maxWidth: 130 }}
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
        >
          <option value="">All Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={() => {
              setFMember("");
              setFMonth(TODAY.slice(0, 7));
              setFStatus("");
            }}
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
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <span
            style={{
              color: "#64748b",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ⏱ Backdate:
          </span>
          {isAdmin ? (
            <select
              style={{ ...inpS, maxWidth: 120, fontSize: 11 }}
              value={backdateDays}
              disabled={!backdateLoaded}
              onChange={(e) => {
                void saveBackdateSetting(parseInt(e.target.value, 10));
              }}
            >
              <option value="0">Today only</option>
              <option value="1">1 day</option>
              <option value="2">2 days</option>
              <option value="3">3 days</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
              <option value="30">1 month</option>
              <option value="-1">No limit</option>
            </select>
          ) : (
            <span
              style={{
                fontSize: 11,
                color: "#475569",
                fontWeight: 600,
                background: "#f1f5f9",
                padding: "3px 8px",
                borderRadius: 4,
              }}
            >
              {backdateLabel}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} records
        </span>
      </div>

      {/* Today's status */}
      {todayRecord && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 8,
            padding: "8px 16px",
            marginBottom: 12,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ color: "#15803d" }}>
            Today ({fmtDate(TODAY)}):
          </strong>
          <span>
            Login: <strong>{fmtClockTime(todayRecord.login_time)}</strong>
          </span>
          <span>
            Logout:{" "}
            <strong>
              {todayRecord.logout_time
                ? fmtClockTime(todayRecord.logout_time)
                : "—"}
            </strong>
          </span>
          <span>
            Location: <strong>{todayRecord.work_location || "—"}</strong>
          </span>
          <span
            style={{
              padding: "1px 8px",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              background: STATUS_CFG[todayRecord.status]?.bg,
              color: STATUS_CFG[todayRecord.status]?.color,
            }}
          >
            {STATUS_CFG[todayRecord.status]?.icon} {todayRecord.status}
          </span>
        </div>
      )}

      {/* Tab content */}
      {subTab === "log" && (
        <AttendanceLogTab
          loading={loading}
          filtered={filtered}
          addRow={addRow}
          setAddRow={setAddRow}
          editId={editId}
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          deleting={deleting}
          isAdmin={isAdmin}
          isManager={isManager}
          myName={myName}
          visibleMembers={visibleMembers}
          minBackdate={minBackdate}
          onSave={handleSave}
          onDelete={(id) => {
            void handleDelete(id);
          }}
          onStartEdit={(r) => {
            setEditId(r.id);
            setEditForm({ ...r });
            setAddRow(null);
          }}
          onCancelAll={() => {
            setEditId(null);
            setEditForm({});
            setAddRow(null);
          }}
        />
      )}
      {subTab === "report" && (
        <AttendanceReportTab records={records} fMonth={fMonth} />
      )}

      <div
        style={{
          marginTop: 16,
          padding: "10px 14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          fontSize: 12,
          color: "#1e40af",
        }}
      >
        📱 <strong>Coming soon:</strong> Mobile app with selfie capture, GPS
        location tagging, and geo-fenced punch-in.
      </div>
    </div>
  );
}
