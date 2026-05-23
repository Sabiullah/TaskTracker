import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import MatrixCell from "./MatrixCell";
import MatrixLegend from "./MatrixLegend";
import { useAttendanceMatrix } from "@/hooks/useAttendanceMatrix";
import { formatTotal, totalsFor, type CellCode, type CellPayload } from "@/utils/matrixCells";
import { TODAY } from "@/utils/date";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { AttendanceDto } from "@/types/api";

interface Props {
  selectedOrg?: string;
}

type StatusValue = "Present" | "Absent" | "Half Day" | "Leave" | "Holiday";

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
  const { data, loading, error, reload } = useAttendanceMatrix(month, selectedOrg);
  const { isAdminInAny } = useAuth();
  const isAdmin = isAdminInAny();

  const [empFilter, setEmpFilter] = useState<Set<string> | null>(null);
  const [codeFilter, setCodeFilter] = useState<Set<CellCode>>(new Set());
  const [empMenuOpen, setEmpMenuOpen] = useState(false);
  const empMenuRef = useRef<HTMLDivElement | null>(null);

  async function handleStatusChange(
    userUid: string,
    date: string,
    status: StatusValue,
  ): Promise<void> {
    try {
      await apiPost<AttendanceDto>("/attendance/set_status/", {
        user_uid: userUid,
        date,
        status,
      });
      // The ws "attendance" subscription in useAttendanceMatrix will fire
      // a refetch; call reload() too in case the socket dropped.
      void reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      alert(`Failed to set status: ${msg}`);
    }
  }

  useEffect(() => {
    if (!empMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (empMenuRef.current && !empMenuRef.current.contains(e.target as Node)) {
        setEmpMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [empMenuOpen]);

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

  const allSelected = empFilter === null;
  const visibleEmps = allSelected
    ? data.employees
    : data.employees.filter((e) => empFilter!.has(e.uid));

  const empButtonLabel = allSelected
    ? `All employees (${data.employees.length})`
    : `${empFilter!.size} selected`;

  return (
    <div>
      <div style={filterBar}>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ ...inp, width: 130 }}
        />
        <div ref={empMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setEmpMenuOpen((v) => !v)}
            style={{
              ...inp,
              minWidth: 170,
              textAlign: "left",
              background: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
            title="Filter employees"
          >
            <span>{empButtonLabel}</span>
            <span style={{ color: "#94a3b8", fontSize: 10 }}>▼</span>
          </button>
          {empMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                zIndex: 20,
                background: "#fff",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                boxShadow: "0 6px 18px rgba(15,23,42,0.12)",
                width: 240,
                maxHeight: 260,
                overflowY: "auto",
                padding: 6,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 6px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1e293b",
                  borderBottom: "1px solid #e2e8f0",
                  marginBottom: 4,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) setEmpFilter(null);
                    else setEmpFilter(new Set());
                  }}
                />
                Select all
              </label>
              {data.employees.map((emp) => {
                const checked = allSelected || empFilter!.has(emp.uid);
                return (
                  <label
                    key={emp.uid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 6px",
                      fontSize: 12,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const base = allSelected
                          ? new Set(data.employees.map((x) => x.uid))
                          : new Set(empFilter!);
                        if (e.target.checked) base.add(emp.uid);
                        else base.delete(emp.uid);
                        if (base.size === data.employees.length) setEmpFilter(null);
                        else setEmpFilter(base);
                      }}
                    />
                    {emp.full_name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
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
                        editable={isAdmin}
                        onStatusChange={(status) => {
                          void handleStatusChange(emp.uid, d.date, status);
                        }}
                      />
                    </td>
                  );
                })}
                {TOTAL_COLS.map((c) => (
                  <td key={c} style={totalCol}>
                    {formatTotal(totalsPerEmp[emp.uid]?.[c] ?? 0)}
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
      row.push(formatTotal(t?.[c] ?? 0));
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
