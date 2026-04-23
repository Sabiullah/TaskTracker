import { useCallback, useEffect, useState } from "react";

import type { ConveyanceEntry } from "@/types/api/conveyance";
import { type ListFilters, listEntries } from "@/utils/conveyanceApi";

import ConveyanceAttachmentList from "./ConveyanceAttachmentList";
import ConveyanceFilters from "./ConveyanceFilters";

interface Props {
  filters: ListFilters;
  onFiltersChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string }[];
}

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

function formatAmount(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return INR.format(n);
}

export default function ConveyanceTransactions({
  filters,
  onFiltersChange,
  canFilterByEmployee,
  employeeOptions,
  clientOptions,
}: Props) {
  const [entries, setEntries] = useState<ConveyanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const page = await listEntries(filters);
        if (signal.cancelled) return;
        setEntries(page.results);
      } catch (err: unknown) {
        if (signal.cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load entries");
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return (
    <div>
      <ConveyanceFilters
        value={filters}
        onChange={onFiltersChange}
        canFilterByEmployee={canFilterByEmployee}
        employeeOptions={employeeOptions}
        clientOptions={clientOptions}
      />

      {error && (
        <div role="alert" style={{ color: "crimson", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-gray-500">No conveyance entries match your filters.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Date</th>
              <th style={{ textAlign: "left" }}>Employee</th>
              <th style={{ textAlign: "left" }}>Client</th>
              <th style={{ textAlign: "left" }}>Reason</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Claimable</th>
              <th>Status</th>
              <th>Attachments</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.uid}>
                <td>{row.date}</td>
                <td>{row.employee_detail.full_name}</td>
                <td>{row.client_detail.name}</td>
                <td title={row.reason} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.reason}
                </td>
                <td style={{ textAlign: "right" }}>{formatAmount(row.amount)}</td>
                <td style={{ textAlign: "center" }}>{row.claimable ? "Yes" : "No"}</td>
                <td style={{ textAlign: "center" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 12,
                      background:
                        row.status === "approved"
                          ? "#d1fae5"
                          : row.status === "rejected"
                            ? "#fee2e2"
                            : "#fef3c7",
                      color:
                        row.status === "approved"
                          ? "#065f46"
                          : row.status === "rejected"
                            ? "#991b1b"
                            : "#92400e",
                    }}
                  >
                    {row.status}
                  </span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <ConveyanceAttachmentList attachments={row.attachments} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
