import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import { fmtMoney } from "@/utils/money";
import type { InvoiceReportGroupBy, InvoiceReportResponse } from "@/types/api";

interface ReportTabProps {
  fy: string;
}

export default function ReportTab({ fy }: ReportTabProps) {
  const { categories } = useInvoiceCategories();
  const [groupBy, setGroupBy] = useState<InvoiceReportGroupBy>("owner");
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<"" | "Confirmed" | "Projected">("");
  const [data, setData] = useState<InvoiceReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    (async () => {
      interface ProfileItem { uid: string; full_name?: string; username?: string; is_active?: boolean }
      const profiles = await apiGet<ProfileItem[]>("/profiles/");
      setOwners(
        profiles.filter((p) => p.is_active !== false).map((p) => ({
          id: p.uid,
          label: p.full_name || p.username || p.uid,
        })),
      );
    })().catch(() => setOwners([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("fy", fy);
      params.set("group_by", groupBy);
      filterCategories.forEach((c) => params.append("category", c));
      filterOwners.forEach((o) => params.append("owner", o));
      if (filterStatus) params.set("project_status", filterStatus);
      try {
        const res = await apiGet<InvoiceReportResponse>(`/invoice_reports/?${params.toString()}`);
        if (!cancelled) setData(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fy, groupBy, filterCategories, filterOwners, filterStatus]);

  const months = useMemo(() => (data ? Object.keys(data.totals).filter((k) => k !== "total") : []), [data]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ["Group", ...months, "Total"];
    const rows = data.rows.map((r) => [r.label, ...months.map((m) => r.monthly[m] ?? "0"), r.total]);
    rows.push(["TOTAL", ...months.map((m) => data.totals[m] ?? "0"), data.totals.total ?? "0"]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-report-${fy}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Group by:
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as InvoiceReportGroupBy)}
            style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }}
          >
            <option value="owner">Owner</option>
            <option value="category">Category</option>
            <option value="month">Month</option>
            <option value="client">Client</option>
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Status:
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }}
          >
            <option value="">Both</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Projected">Projected</option>
          </select>
        </label>
        <button
          onClick={downloadCsv}
          disabled={!data}
          style={{ padding: "4px 10px", border: "1.5px solid #2563eb", color: "#2563eb", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}
        >
          ⬇ CSV
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Categories:</span>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => toggle(filterCategories, setFilterCategories, c.id)}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: filterCategories.includes(c.id) ? "#dbeafe" : "#fff",
              cursor: "pointer",
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Owners:</span>
        {owners.map((o) => (
          <button
            key={o.id}
            onClick={() => toggle(filterOwners, setFilterOwners, o.id)}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: filterOwners.includes(o.id) ? "#fef3c7" : "#fff",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: 16, textAlign: "center" }}>Loading…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 16, textAlign: "center", color: "#64748b" }}>No matching entries. Try widening the filters.</div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: 6, textAlign: "left", border: "1px solid #e2e8f0" }}>Group</th>
                {months.map((m) => (
                  <th key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>{m.slice(5)}</th>
                ))}
                <th style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} style={{ background: r.key === "Unattributed" ? "#fff7ed" : "#fff" }}>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{r.label}</td>
                  {months.map((m) => (
                    <td key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                      {fmtMoney(Number(r.monthly[m] || 0))}
                    </td>
                  ))}
                  <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0", fontWeight: 700 }}>
                    {fmtMoney(Number(r.total))}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>TOTAL</td>
                {months.map((m) => (
                  <td key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                    {fmtMoney(Number(data.totals[m] || 0))}
                  </td>
                ))}
                <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                  {fmtMoney(Number(data.totals.total || 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
