import { useEffect, useMemo, useState } from "react";

import type { SummaryGroupBy, SummaryResponse } from "@/types/api/conveyance";
import { fetchSummary } from "@/utils/conveyanceApi";
import { buildTooltip, formatAmount } from "./conveyanceSummaryHelpers";

type Mode = "single" | "trailing";

interface DrillDownFilters {
  employee_uid?: string;
  client_uid?: string;
  month?: string;
}

interface Props {
  groupBy: SummaryGroupBy;
  onDrillDown: (filters: DrillDownFilters) => void;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ConveyanceSummary({ groupBy, onDrillDown }: Props) {
  const [mode, setMode] = useState<Mode>("single");
  const [month, setMonth] = useState<string>(currentMonth());
  const [monthsCount, setMonthsCount] = useState<number>(6);
  const [end, setEnd] = useState<string>(currentMonth());

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(
    () => async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchSummary(
          mode === "single"
            ? { group_by: groupBy, mode: "single", month }
            : { group_by: groupBy, mode: "trailing", months: monthsCount, end },
        );
        if (!signal.aborted) setData(res);
      } catch (err: unknown) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load summary");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [mode, month, monthsCount, end, groupBy],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const keyParam: "employee_uid" | "client_uid" =
    groupBy === "employee" ? "employee_uid" : "client_uid";

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Mode:{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="single">Single month</option>
            <option value="trailing">Trailing</option>
          </select>
        </label>
        {mode === "single" ? (
          <label>
            Month:{" "}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              Months:{" "}
              <input
                type="number"
                min={1}
                max={12}
                value={monthsCount}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n)) setMonthsCount(Math.max(1, Math.min(12, n)));
                }}
                style={{ width: 64 }}
              />
            </label>
            <label>
              End:{" "}
              <input type="month" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {error && (
        <div role="alert" style={{ color: "crimson", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : data === null ? null : data.mode === "single" ? (
        data.rows.length === 0 ? (
          <div style={{ color: "#6b7280" }}>
            No approved claimable conveyance entries in {data.month}.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{groupBy === "employee" ? "Employee" : "Client"}</th>
                <th style={{ textAlign: "right" }}>Entries</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.key_uid}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    onDrillDown({ [keyParam]: row.key_uid, month: data.month } as DrillDownFilters)
                  }
                  title={buildTooltip(row.top_entries, row.entry_count)}
                >
                  <td>{row.key_label}</td>
                  <td style={{ textAlign: "right" }}>{row.entry_count}</td>
                  <td style={{ textAlign: "right" }}>{formatAmount(row.total)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600, borderTop: "2px solid #e5e7eb" }}>
                <td>Grand total</td>
                <td></td>
                <td style={{ textAlign: "right" }}>{formatAmount(data.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        )
      ) : (
        // Trailing mode
        data.rows.length === 0 ? (
          <div style={{ color: "#6b7280" }}>
            No approved claimable conveyance entries in this window.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>
                  {groupBy === "employee" ? "Employee" : "Client"}
                </th>
                {data.months.map((m) => (
                  <th key={m} style={{ textAlign: "right" }}>
                    {m}
                  </th>
                ))}
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key_uid}>
                  <td>{row.key_label}</td>
                  {data.months.map((m) => {
                    const amount = row.monthly[m] ?? "0.00";
                    return (
                      <td
                        key={m}
                        style={{ textAlign: "right", cursor: "pointer" }}
                        onClick={() =>
                          onDrillDown({ [keyParam]: row.key_uid, month: m } as DrillDownFilters)
                        }
                        title={`${row.key_label} · ${m} · ${formatAmount(amount)}`}
                      >
                        {formatAmount(amount)}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "right", fontWeight: 500 }}>
                    {formatAmount(row.total)}
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600, borderTop: "2px solid #e5e7eb" }}>
                <td>Column total</td>
                {data.months.map((m) => (
                  <td key={m} style={{ textAlign: "right" }}>
                    {formatAmount(data.column_totals[m] ?? "0.00")}
                  </td>
                ))}
                <td style={{ textAlign: "right" }}>{formatAmount(data.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
