import { useMemo, useState, type CSSProperties } from "react";

import MatrixCell from "./MatrixCell";
import MatrixLegend from "./MatrixLegend";
import { useAttendanceMatrix } from "@/hooks/useAttendanceMatrix";
import { totalsFor, type CellCode, type CellPayload } from "@/utils/matrixCells";
import { TODAY } from "@/utils/date";

interface Props {
  selectedOrg?: string;
}

const TOTAL_COLS: CellCode[] = ["P", "H", "L", "WFH", "HW", "?", "WP"];

const filterBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};

const inp: CSSProperties = {
  padding: "5px 9px",
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  fontSize: 13,
};

const head: CSSProperties = {
  padding: 4,
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  textAlign: "center",
  borderBottom: "1px solid #e2e8f0",
};

const empCell: CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 600,
  color: "#1e293b",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#fff",
  position: "sticky",
  left: 0,
  zIndex: 1,
};

const totalCol: CSSProperties = {
  padding: "4px 6px",
  fontSize: 11,
  fontWeight: 700,
  color: "#1e293b",
  textAlign: "center",
  borderBottom: "1px solid #f1f5f9",
  borderLeft: "1px solid #e2e8f0",
};

const tableWrap: CSSProperties = {
  overflow: "auto",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  maxHeight: "calc(100vh - 320px)",
};

export default function AttendanceMatrixView({ selectedOrg }: Props) {
  const [month, setMonth] = useState(TODAY.slice(0, 7));
  const { data, loading, error } = useAttendanceMatrix(month, selectedOrg);

  const [empFilter, setEmpFilter] = useState<Set<string>>(new Set());
  const [codeFilter, setCodeFilter] = useState<Set<CellCode>>(new Set());

  const totalsPerEmp = useMemo(() => {
    if (!data) return {} as Record<string, ReturnType<typeof totalsFor>>;
    const out: Record<string, ReturnType<typeof totalsFor>> = {};
    for (const emp of data.employees) {
      out[emp.uid] = totalsFor(data.cells[emp.uid] ?? {});
    }
    return out;
  }, [data]);

  if (loading || !data) {
    return <div style={{ padding: 14, color: "#64748b" }}>Loading matrix…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 14, color: "#dc2626", background: "#fee2e2", borderRadius: 6 }}>
        Failed to load matrix: {error}
      </div>
    );
  }

  const visibleEmps =
    empFilter.size === 0
      ? data.employees
      : data.employees.filter((e) => empFilter.has(e.uid));

  return (
    <div>
      <div style={filterBar}>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={inp}
        />
        <select
          multiple
          value={[...empFilter]}
          onChange={(e) =>
            setEmpFilter(
              new Set(
                Array.from(e.target.selectedOptions).map((o) => o.value),
              ),
            )
          }
          style={{ ...inp, minWidth: 180, fontSize: 12, padding: 4 }}
          title="Hold Ctrl/Cmd to multi-select; empty = show all"
        >
          {data.employees.map((e) => (
            <option key={e.uid} value={e.uid}>
              {e.full_name}
            </option>
          ))}
        </select>
        {(["?", "WP", "A"] as const).map((c) => (
          <label
            key={c}
            style={{
              fontSize: 12,
              color: "#475569",
              display: "flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={codeFilter.has(c)}
              onChange={(e) => {
                const next = new Set(codeFilter);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                setCodeFilter(next);
              }}
            />
            Highlight {c}
          </label>
        ))}
        <button
          onClick={() => exportMatrixCsv(data, totalsPerEmp, month)}
          style={{
            padding: "5px 12px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ⬇ Export CSV
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {visibleEmps.length} employees · {data.dates.length} days
        </span>
      </div>

      <MatrixLegend />

      <div style={tableWrap}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...empCell, top: 0, zIndex: 3 }}>Employee</th>
              {data.dates.map((d) => (
                <th
                  key={d.date}
                  style={{
                    ...head,
                    minWidth: 32,
                    background: d.is_holiday
                      ? "#fff7ed"
                      : d.weekday === "Sun" && !d.is_override
                        ? "#f1f5f9"
                        : "#fff",
                  }}
                >
                  <div>{parseInt(d.date.slice(8), 10)}</div>
                  <div style={{ fontWeight: 500, color: "#94a3b8" }}>{d.weekday[0]}</div>
                </th>
              ))}
              {TOTAL_COLS.map((c) => (
                <th key={c} style={{ ...head, ...totalCol }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleEmps.map((emp) => (
              <tr key={emp.uid}>
                <td style={empCell}>
                  {emp.full_name}
                  {emp.org_uids.length > 1 && (
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {emp.org_uids.length} orgs
                    </div>
                  )}
                </td>
                {data.dates.map((d) => {
                  const c: CellPayload =
                    data.cells[emp.uid]?.[d.date] ?? { code: "A" };
                  return (
                    <td
                      key={d.date}
                      style={{ padding: 0, borderBottom: "1px solid #f1f5f9" }}
                    >
                      <MatrixCell
                        date={d.date}
                        payload={c}
                        outlined={codeFilter.has(c.code)}
                      />
                    </td>
                  );
                })}
                {TOTAL_COLS.map((c) => (
                  <td key={c} style={totalCol}>
                    {totalsPerEmp[emp.uid]?.[c] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
            {visibleEmps.length === 0 && (
              <tr>
                <td
                  colSpan={1 + data.dates.length + TOTAL_COLS.length}
                  style={{
                    padding: 20,
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: 13,
                  }}
                >
                  No employees match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exportMatrixCsv(
  data: import("@/hooks/useAttendanceMatrix").MatrixPayload,
  totalsPerEmp: Record<string, ReturnType<typeof totalsFor>>,
  month: string,
): void {
  const headerCells: string[] = [
    "Employee",
    ...data.dates.map((d) => `${d.date.slice(8)} ${d.weekday[0]}`),
    ...TOTAL_COLS,
  ];
  const rows: string[][] = [headerCells];
  for (const emp of data.employees) {
    const row: string[] = [emp.full_name];
    for (const d of data.dates) {
      row.push(data.cells[emp.uid]?.[d.date]?.code ?? "A");
    }
    const t = totalsPerEmp[emp.uid];
    for (const c of TOTAL_COLS) {
      row.push(String(t?.[c] ?? 0));
    }
    rows.push(row);
  }
  const csv = rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-matrix-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
