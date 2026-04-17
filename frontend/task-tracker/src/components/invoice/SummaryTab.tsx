import { useState, useMemo } from "react";
import { MONTH_SHORT, tdS, thS } from "@/utils/invoice";
import { fmtMoney } from "@/utils/money";
import type { InvoiceEntry } from "@/types";

interface SummaryTabProps {
  entries: InvoiceEntry[];
  fyMonths: string[];
  loading: boolean;
}

interface MonthCell {
  total: number;
  approved: number;
  pending: number;
}

type ClientSummary = Record<string, MonthCell>;

export default function SummaryTab({
  entries,
  fyMonths,
  loading,
}: SummaryTabProps) {
  const [fClient, setFClient] = useState("");
  const summary = useMemo<Record<string, ClientSummary>>(() => {
    const map: Record<string, ClientSummary> = {};
    entries
      .filter((e) => fyMonths.includes(e.invoice_month))
      .forEach((e) => {
        if (!map[e.client_name]) map[e.client_name] = {};
        if (!map[e.client_name][e.invoice_month])
          map[e.client_name][e.invoice_month] = {
            total: 0,
            approved: 0,
            pending: 0,
          };
        const a = Number(e.amount || 0);
        map[e.client_name][e.invoice_month].total += a;
        if (e.status === "Approved")
          map[e.client_name][e.invoice_month].approved += a;
        else if (["Pending", "Uploaded"].includes(e.status))
          map[e.client_name][e.invoice_month].pending += a;
      });
    return map;
  }, [entries, fyMonths]);

  const clients = Object.keys(summary)
    .sort()
    .filter((c) => !fClient || c === fClient);
  const colTotals = fyMonths.map((m) =>
    clients.reduce((s, c) => s + (summary[c]?.[m]?.total || 0), 0),
  );
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);
  const allClients = Object.keys(summary).sort();

  if (loading)
    return <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{
            padding: "4px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 5,
            fontSize: 12,
          }}
        >
          <option value="">All Clients</option>
          {allClients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          ✅ Approved 🟡 Pending
        </span>
      </div>
      <div className="sticky-table-wrap">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead>
            <tr>
              <th style={{ ...thS, minWidth: 150 }}>Client</th>
              {fyMonths.map((m, i) => (
                <th key={m} style={{ ...thS, textAlign: "right", width: 80 }}>
                  {MONTH_SHORT[i]}
                </th>
              ))}
              <th style={{ ...thS, textAlign: "right", width: 90 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td
                  colSpan={fyMonths.length + 2}
                  style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}
                >
                  No invoice data for this FY
                </td>
              </tr>
            ) : (
              clients.map((client) => {
                const rowTotal = fyMonths.reduce(
                  (s, m) => s + (summary[client]?.[m]?.total || 0),
                  0,
                );
                return (
                  <tr
                    key={client}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    <td style={{ ...tdS, fontWeight: 700 }}>{client}</td>
                    {fyMonths.map((m) => {
                      const cell = summary[client]?.[m];
                      return (
                        <td key={m} style={{ ...tdS, textAlign: "right" }}>
                          {cell?.total ? (
                            <div>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cell.approved === cell.total
                                      ? "#16a34a"
                                      : "#1e293b",
                                }}
                              >
                                {fmtMoney(cell.total)}
                              </div>
                              {cell.pending > 0 && (
                                <div style={{ fontSize: 10, color: "#d97706" }}>
                                  🟡 {fmtMoney(cell.pending)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#e2e8f0" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        ...tdS,
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#2563eb",
                      }}
                    >
                      {fmtMoney(rowTotal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {clients.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                <td style={tdS}>Monthly Total</td>
                {colTotals.map((t, i) => (
                  <td
                    key={i}
                    style={{
                      ...tdS,
                      textAlign: "right",
                      color: t ? "#16a34a" : "#94a3b8",
                    }}
                  >
                    {t ? fmtMoney(t) : "—"}
                  </td>
                ))}
                <td style={{ ...tdS, textAlign: "right", color: "#2563eb" }}>
                  {fmtMoney(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
