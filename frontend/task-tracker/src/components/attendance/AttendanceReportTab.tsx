import { useMemo } from "react";
import { thS, tdS } from "@/utils/attendance";
import { formatMonthLabel as fmtMonthLabel } from "@/utils/date";
import type { AttendanceRecord } from "@/types";

interface ReportRow {
  name: string;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  wfh: number;
  total: number;
}

interface Props {
  records: AttendanceRecord[];
  fMonth: string;
}

export default function AttendanceReportTab({ records, fMonth }: Props) {
  const reportData = useMemo<ReportRow[]>(() => {
    const monthRecs = records.filter(
      (r) => !fMonth || (r.date ?? "").startsWith(fMonth),
    );
    const byName: Record<string, ReportRow> = {};
    for (const r of monthRecs) {
      if (!byName[r.employee_name]) {
        byName[r.employee_name] = { name: r.employee_name, present: 0, absent: 0, halfDay: 0, leave: 0, wfh: 0, total: 0 };
      }
      const e = byName[r.employee_name];
      e.total++;
      if (r.status === "Present") e.present++;
      else if (r.status === "Absent") e.absent++;
      else if (r.status === "Half Day") e.halfDay++;
      else if (r.status === "Leave") e.leave++;
      else if (r.status === "WFH") e.wfh++;
    }
    return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
  }, [records, fMonth]);

  return (
    <div className="dm-box" style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
        📊 Attendance Report — {fmtMonthLabel(fMonth) || "All Time"}
      </div>
      <div className="sticky-table-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...thS, width: 36 }}>#</th>
              <th style={thS}>Employee</th>
              <th style={{ ...thS, width: 60, textAlign: "center" }}>Total</th>
              <th style={{ ...thS, width: 70, textAlign: "center", color: "#16a34a" }}>🟢 Present</th>
              <th style={{ ...thS, width: 60, textAlign: "center", color: "#dc2626" }}>🔴 Absent</th>
              <th style={{ ...thS, width: 65, textAlign: "center", color: "#d97706" }}>🟡 Half Day</th>
              <th style={{ ...thS, width: 55, textAlign: "center", color: "#7c3aed" }}>🟣 Leave</th>
              <th style={{ ...thS, width: 50, textAlign: "center", color: "#0891b2" }}>🔵 WFH</th>
              <th style={{ ...thS, width: 100 }}>Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {reportData.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                  No data for this period.
                </td>
              </tr>
            )}
            {reportData.map((r, i) => {
              const workDays = r.present + r.halfDay * 0.5 + r.wfh;
              const pct = r.total > 0 ? Math.round((workDays / r.total) * 100) : 0;
              const barColor = pct >= 90 ? "#16a34a" : pct >= 70 ? "#d97706" : "#dc2626";
              return (
                <tr key={r.name} onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={{ ...tdS, color: "#94a3b8", fontSize: 11 }}>{i + 1}</td>
                  <td style={{ ...tdS, fontWeight: 600, color: "#1e293b" }}>{r.name}</td>
                  <td style={{ ...tdS, textAlign: "center", fontWeight: 700 }}>{r.total}</td>
                  <td style={{ ...tdS, textAlign: "center", color: "#16a34a", fontWeight: 600 }}>{r.present}</td>
                  <td style={{ ...tdS, textAlign: "center", color: "#dc2626", fontWeight: 600 }}>{r.absent || "—"}</td>
                  <td style={{ ...tdS, textAlign: "center", color: "#d97706", fontWeight: 600 }}>{r.halfDay || "—"}</td>
                  <td style={{ ...tdS, textAlign: "center", color: "#7c3aed", fontWeight: 600 }}>{r.leave || "—"}</td>
                  <td style={{ ...tdS, textAlign: "center", color: "#0891b2", fontWeight: 600 }}>{r.wfh || "—"}</td>
                  <td style={tdS}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width .3s" }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: barColor, minWidth: 36, textAlign: "right" }}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {reportData.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td style={tdS} />
                <td style={{ ...tdS, fontWeight: 700 }}>Total</td>
                <td style={{ ...tdS, textAlign: "center" }}>{reportData.reduce((s, r) => s + r.total, 0)}</td>
                <td style={{ ...tdS, textAlign: "center", color: "#16a34a" }}>{reportData.reduce((s, r) => s + r.present, 0)}</td>
                <td style={{ ...tdS, textAlign: "center", color: "#dc2626" }}>{reportData.reduce((s, r) => s + r.absent, 0) || "—"}</td>
                <td style={{ ...tdS, textAlign: "center", color: "#d97706" }}>{reportData.reduce((s, r) => s + r.halfDay, 0) || "—"}</td>
                <td style={{ ...tdS, textAlign: "center", color: "#7c3aed" }}>{reportData.reduce((s, r) => s + r.leave, 0) || "—"}</td>
                <td style={{ ...tdS, textAlign: "center", color: "#0891b2" }}>{reportData.reduce((s, r) => s + r.wfh, 0) || "—"}</td>
                <td style={tdS} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
