import { useState } from "react";
import { fmtDate } from "@/utils/date";
import { DailyStandupRow } from "./DailyStandupRow";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupDateSectionProps {
  date: string; // YYYY-MM-DD
  rows: OperationalStandupRosterRow[];
  defaultExpanded: boolean;
  canFinalReview: boolean;
  pendingCount: number;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string) => Promise<void>;
  onFinalReview: (date: string) => Promise<void>;
}

export function DailyStandupDateSection({
  date,
  rows,
  defaultExpanded,
  canFinalReview,
  pendingCount,
  onSave,
  onApprove,
  onFinalReview,
}: DailyStandupDateSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const submitted = rows.filter((r) => r.entry !== null).length;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "#f8fafc",
          borderBottom: expanded ? "1px solid #e2e8f0" : "none",
          borderRadius: expanded ? "8px 8px 0 0" : 8,
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
            fontSize: 13,
            color: "#1e293b",
          }}
        >
          <span>{expanded ? "▾" : "▸"}</span>
          <span>📅 {fmtDate(date)}</span>
          <span style={{ color: "#64748b", fontWeight: 500 }}>
            · {submitted}/{rows.length} submitted
          </span>
          {pendingCount > 0 && (
            <span style={{ color: "#d97706", fontWeight: 700 }}>
              · {pendingCount} pending
            </span>
          )}
        </button>
        {canFinalReview && pendingCount > 0 && (
          <button
            onClick={() => void onFinalReview(date)}
            style={{
              padding: "6px 14px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Final Review
          </button>
        )}
      </div>
      {expanded && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Employee</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Type</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Priorities</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Collaboration</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Remarks</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>By</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Status</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <DailyStandupRow
                key={`${r.org_uid}-${r.profile.uid}`}
                row={r}
                onSave={(p, uid) => onSave({ ...p, standup_date: date }, uid)}
                onApprove={onApprove}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
