import { useMemo, useState, type CSSProperties } from "react";

import ApplyLeaveModal from "./ApplyLeaveModal";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate } from "@/utils/date";
import { ApiError } from "@/lib/api";

const cell: CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  borderBottom: "1px solid #e2e8f0",
};
const head: CSSProperties = {
  ...cell,
  background: "#f8fafc",
  fontWeight: 700,
  textAlign: "left",
};
const inp: CSSProperties = {
  padding: "5px 9px",
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  fontSize: 13,
};

const STATUS_BG: Record<string, { bg: string; color: string }> = {
  Pending: { bg: "#fef3c7", color: "#92400e" },
  Approved: { bg: "#dcfce7", color: "#166534" },
  Rejected: { bg: "#fee2e2", color: "#991b1b" },
  Withdrawn: { bg: "#e2e8f0", color: "#475569" },
};

function formatErr(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export default function EmployeeLeaveTab() {
  const { profile } = useAuth();
  const { items, loading, create, withdraw } = useLeaveRequests();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [fMonth, setFMonth] = useState("");

  const my = useMemo(
    () => items.filter((r) => r.user_uid === profile?.id),
    [items, profile?.id],
  );
  const filtered = my.filter(
    (r) =>
      (!fStatus || r.status === fStatus) &&
      (!fMonth || r.from_date.startsWith(fMonth)),
  );

  const handleWithdraw = async (uid: string): Promise<void> => {
    if (!window.confirm("Withdraw this leave request?")) return;
    setBusyId(uid);
    try {
      await withdraw(uid);
    } catch (err) {
      window.alert(`Withdraw failed: ${formatErr(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, color: "#1e293b" }}>
          My Leave Requests
        </h2>
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "7px 14px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          + Apply Leave
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select style={inp} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option>Pending</option>
          <option>Approved</option>
          <option>Rejected</option>
          <option>Withdrawn</option>
        </select>
        <input type="month" style={inp} value={fMonth} onChange={(e) => setFMonth(e.target.value)} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} request(s)
        </span>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {loading && <div style={{ padding: 14, color: "#64748b", fontSize: 13 }}>Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 14, color: "#64748b", fontSize: 13 }}>
            No leave requests yet. Click &quot;+ Apply Leave&quot; to file your first one.
          </div>
        )}
        {filtered.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...head, width: 36 }}>#</th>
                <th style={head}>From</th>
                <th style={head}>To</th>
                <th style={{ ...head, width: 60, textAlign: "right" }}>Days</th>
                <th style={head}>Reason</th>
                <th style={{ ...head, width: 100 }}>Status</th>
                <th style={head}>Approver</th>
                <th style={head}>Decided</th>
                <th style={{ ...head, width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const st = STATUS_BG[r.status] ?? STATUS_BG.Pending;
                return (
                  <tr key={r.id}>
                    <td style={{ ...cell, color: "#94a3b8", fontSize: 11 }}>{i + 1}</td>
                    <td style={cell}>
                      {fmtDate(r.from_date)}
                      <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>({r.from_session})</span>
                    </td>
                    <td style={cell}>
                      {fmtDate(r.to_date)}
                      <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>({r.to_session})</span>
                    </td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{r.total_days}</td>
                    <td style={cell}>{r.reason}</td>
                    <td style={cell}>
                      <span
                        style={{
                          background: st.bg,
                          color: st.color,
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td style={cell}>{r.approver_name ?? "—"}</td>
                    <td style={cell}>
                      {r.approved_at ? fmtDate(r.approved_at.slice(0, 10)) : "—"}
                    </td>
                    <td style={cell}>
                      {(r.status === "Pending" || r.status === "Approved") && (
                        <button
                          disabled={busyId === r.id}
                          onClick={() => {
                            void handleWithdraw(r.id);
                          }}
                          style={{
                            padding: "3px 10px",
                            background: "#fee2e2",
                            color: "#dc2626",
                            border: "none",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {busyId === r.id ? "…" : "Withdraw"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ApplyLeaveModal
        open={open}
        profile={profile}
        onClose={() => setOpen(false)}
        onSubmit={async (body) => {
          // Let errors propagate so the modal stays open and surfaces them.
          await create(body);
        }}
      />
    </div>
  );
}
