import { useMemo, type CSSProperties } from "react";
import type { OperationalStandupDto } from "@/types/api";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";
import type { CellPayload } from "@/utils/matrixCells";
import {
  approvalTint,
  attendanceFallbackLabel,
  uniqueSubmittedEmployees,
} from "./standupMatrix";

export interface DailyStandupMatrixViewProps {
  readonly month: string;
  readonly standups: readonly OperationalStandupDto[];
  readonly attendanceMatrix: MatrixPayload | null;
  readonly loading: boolean;
}

const wrap: CSSProperties = {
  overflow: "auto",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  maxHeight: "calc(100vh - 320px)",
};

const empty: CSSProperties = {
  padding: 24,
  textAlign: "center",
  color: "#94a3b8",
  fontSize: 13,
};

const empCell: CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#1e293b",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#fff",
  position: "sticky",
  left: 0,
  zIndex: 1,
  verticalAlign: "top",
  minWidth: 180,
};

const headCell: CSSProperties = {
  padding: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  textAlign: "center",
  borderBottom: "1px solid #e2e8f0",
  background: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 2,
  minWidth: 220,
};

const dataCell: CSSProperties = {
  padding: 8,
  fontSize: 12,
  color: "#1e293b",
  borderBottom: "1px solid #f1f5f9",
  borderLeft: "3px solid transparent",
  verticalAlign: "top",
  minWidth: 220,
  maxWidth: 280,
  whiteSpace: "pre-wrap",
};

const chip = (bg: string, color: string): CSSProperties => ({
  display: "inline-block",
  background: bg,
  color,
  fontSize: 10,
  fontWeight: 700,
  padding: "1px 6px",
  borderRadius: 4,
  marginBottom: 4,
});

const fallback: CSSProperties = {
  fontStyle: "italic",
  color: "#94a3b8",
  fontSize: 11,
};

function dayLabel(date: string): string {
  return String(parseInt(date.slice(8), 10));
}

interface EntryCellProps {
  readonly entry: OperationalStandupDto;
}

function EntryCell({ entry }: EntryCellProps): JSX.Element {
  const tint = approvalTint(entry.approvals);
  const style: CSSProperties = { ...dataCell, borderLeftColor: tint };
  const title =
    `Collaboration: ${entry.collaboration_need || "—"}\n` +
    `Remarks: ${entry.remarks || "—"}`;
  return (
    <td style={style} title={title}>
      {entry.breakthrough_type === "Breakthrough" && (
        <span style={chip("#dcfce7", "#166534")}>BT</span>
      )}
      {entry.breakthrough_type === "Breakdown" && (
        <span style={chip("#fed7aa", "#9a3412")}>BD</span>
      )}
      <div>{entry.priorities}</div>
    </td>
  );
}

interface FallbackCellProps {
  readonly cell: CellPayload | undefined;
}

function FallbackCell({ cell }: FallbackCellProps): JSX.Element {
  const label = attendanceFallbackLabel(cell);
  return (
    <td style={dataCell}>
      {label ? (
        <span style={{ ...fallback, color: label.color }}>{label.text}</span>
      ) : (
        <span style={fallback}>—</span>
      )}
    </td>
  );
}

export function DailyStandupMatrixView({
  standups,
  attendanceMatrix,
  loading,
}: DailyStandupMatrixViewProps): JSX.Element {
  const employees = useMemo(() => uniqueSubmittedEmployees(standups), [standups]);

  const byEmpDate = useMemo(() => {
    const m = new Map<string, Map<string, OperationalStandupDto>>();
    for (const s of standups) {
      const empUid = s.profile_detail.uid;
      let inner = m.get(empUid);
      if (!inner) {
        inner = new Map();
        m.set(empUid, inner);
      }
      inner.set(s.standup_date, s);
    }
    return m;
  }, [standups]);

  const dates = attendanceMatrix?.dates ?? [];

  if (loading && !attendanceMatrix && standups.length === 0) {
    return <div style={empty}>Loading matrix…</div>;
  }

  if (employees.length === 0) {
    return (
      <div style={wrap}>
        <div style={empty}>No standup entries this month.</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...empCell, ...headCell, zIndex: 3, minWidth: 180 }}>
              Employee
            </th>
            {dates.map((d) => {
              const isHoliday = d.is_holiday || (d.weekday === "Sun" && !d.is_override);
              return (
                <th
                  key={d.date}
                  style={{
                    ...headCell,
                    background: isHoliday ? "#f1f5f9" : "#fff",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#94a3b8" }}>{d.weekday}</div>
                  <div>{dayLabel(d.date)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const inner = byEmpDate.get(emp.uid);
            return (
              <tr key={emp.uid}>
                <td style={empCell}>
                  <div>{emp.full_name}</div>
                  {emp.org_names.length > 0 && (
                    <div style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>
                      {emp.org_names.join(" · ")}
                    </div>
                  )}
                </td>
                {dates.map((d) => {
                  const entry = inner?.get(d.date);
                  if (entry) return <EntryCell key={d.date} entry={entry} />;
                  const cell = attendanceMatrix?.cells[emp.uid]?.[d.date];
                  return <FallbackCell key={d.date} cell={cell} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
