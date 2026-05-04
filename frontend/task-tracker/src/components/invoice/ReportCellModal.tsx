import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { fmtMoney } from "@/utils/money";
import type {
  InvoiceReportCellResponse,
  InvoiceReportGroupBy,
} from "@/types/api";

export interface ReportCellModalProps {
  fy: string;
  groupBy: Exclude<InvoiceReportGroupBy, "client">;
  rowKey: string;
  month: string;
  title: string;
  filterCategories: readonly string[];
  filterOwners: readonly string[];
  filterStatus: "" | "Confirmed" | "Projected";
  onClose: () => void;
}

export default function ReportCellModal({
  fy,
  groupBy,
  rowKey,
  month,
  title,
  filterCategories,
  filterOwners,
  filterStatus,
  onClose,
}: ReportCellModalProps) {
  const [data, setData] = useState<InvoiceReportCellResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      params.set("fy", fy);
      params.set("group_by", groupBy);
      params.set("row_key", rowKey);
      params.set("month", month);
      filterCategories.forEach((c) => params.append("category", c));
      filterOwners.forEach((o) => params.append("owner", o));
      if (filterStatus) params.set("project_status", filterStatus);
      try {
        const res = await apiGet<InvoiceReportCellResponse>(
          `/invoice_reports/cell/?${params.toString()}`,
        );
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fy, groupBy, rowKey, month, filterCategories, filterOwners, filterStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showMonthCol = useMemo(() => {
    if (!data) return false;
    const months = new Set(data.rows.map((r) => r.month));
    return months.size > 1;
  }, [data]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
            Loading…
          </div>
        )}
        {error && (
          <div
            style={{
              padding: 16,
              color: "#b91c1c",
              background: "#fef2f2",
              borderRadius: 8,
            }}
          >
            Failed to load: {error}
          </div>
        )}
        {!loading && !error && data && data.rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
            No matching entries.
          </div>
        )}
        {!loading && !error && data && data.rows.length > 0 && (
          <table
            style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}
          >
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th
                  style={{
                    padding: 6,
                    textAlign: "left",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  Client
                </th>
                <th
                  style={{
                    padding: 6,
                    textAlign: "left",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  Category
                </th>
                {showMonthCol && (
                  <th
                    style={{
                      padding: 6,
                      textAlign: "left",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    Month
                  </th>
                )}
                <th
                  style={{
                    padding: 6,
                    textAlign: "right",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                    {r.client}
                  </td>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                    {r.category}
                  </td>
                  {showMonthCol && (
                    <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                      {r.month.slice(5)}
                    </td>
                  )}
                  <td
                    style={{
                      padding: 6,
                      textAlign: "right",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    {fmtMoney(Number(r.amount))}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td
                  colSpan={showMonthCol ? 3 : 2}
                  style={{ padding: 6, border: "1px solid #e2e8f0" }}
                >
                  Total — {data.client_count} client
                  {data.client_count === 1 ? "" : "s"}
                </td>
                <td
                  style={{
                    padding: 6,
                    textAlign: "right",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {fmtMoney(Number(data.total_amount))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
