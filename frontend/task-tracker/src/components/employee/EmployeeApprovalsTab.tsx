import { useState, type CSSProperties } from "react";

import RejectModal from "./RejectModal";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useWfhApprovals } from "@/hooks/useWfhApprovals";
import { fmtDate } from "@/utils/date";
import { fmtClockTime } from "@/utils/time";
import { ApiError } from "@/lib/api";

type RejectTarget =
  | { kind: "wfh"; uid: string; label: string }
  | { kind: "leave"; uid: string; label: string }
  | null;

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

const sectionCard: CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  marginBottom: 16,
  overflow: "hidden",
};

const sectionHeader: CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 700,
  fontSize: 14,
  color: "#1e293b",
};

const empty: CSSProperties = {
  padding: 16,
  color: "#64748b",
  fontSize: 13,
};

const btnApprove: CSSProperties = {
  padding: "4px 10px",
  background: "#16a34a",
  color: "#fff",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginRight: 6,
};

const btnReject: CSSProperties = {
  padding: "4px 10px",
  background: "#fee2e2",
  color: "#dc2626",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

function formatErr(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export default function EmployeeApprovalsTab() {
  const wfh = useWfhApprovals();
  const leave = useLeaveRequests();
  const pendingLeave = leave.items.filter((l) => l.status === "Pending");
  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleApproveWfh = async (uid: string): Promise<void> => {
    setBusyId(uid);
    try {
      await wfh.approve(uid);
    } catch (err) {
      window.alert(`Approve failed: ${formatErr(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveLeave = async (uid: string): Promise<void> => {
    setBusyId(uid);
    try {
      await leave.approve(uid);
    } catch (err) {
      window.alert(`Approve failed: ${formatErr(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectSubmit = async (reason: string): Promise<void> => {
    if (!rejectTarget) return;
    if (!reason) {
      window.alert("Reason is required");
      return;
    }
    try {
      if (rejectTarget.kind === "wfh") {
        await wfh.reject(rejectTarget.uid, reason);
      } else {
        await leave.reject(rejectTarget.uid, reason);
      }
    } catch (err) {
      window.alert(`Reject failed: ${formatErr(err)}`);
      throw err; // keep modal open so user can retry
    }
  };

  return (
    <div style={{ padding: "10px 16px" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#1e293b" }}>
        Approvals
      </h2>

      {/* WFH approvals */}
      <section style={sectionCard}>
        <div style={sectionHeader}>WFH approvals ({wfh.items.length})</div>
        {wfh.loading && <div style={empty}>Loading…</div>}
        {!wfh.loading && wfh.items.length === 0 && (
          <div style={empty}>Nothing pending.</div>
        )}
        {wfh.items.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Employee</th>
                <th style={head}>Date</th>
                <th style={head}>Login</th>
                <th style={head}>Logout</th>
                <th style={head}>Remarks</th>
                <th style={{ ...head, width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {wfh.items.map((r) => (
                <tr key={r.id}>
                  <td style={cell}>{r.employee_name}</td>
                  <td style={cell}>{fmtDate(r.date ?? "")}</td>
                  <td style={cell}>{fmtClockTime(r.login_time)}</td>
                  <td style={cell}>{fmtClockTime(r.logout_time) || "—"}</td>
                  <td style={cell}>{r.remarks || "—"}</td>
                  <td style={cell}>
                    <button
                      style={btnApprove}
                      disabled={busyId === r.id}
                      onClick={() => {
                        void handleApproveWfh(r.id);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      style={btnReject}
                      disabled={busyId === r.id}
                      onClick={() =>
                        setRejectTarget({
                          kind: "wfh",
                          uid: r.id,
                          label: `WFH ${r.employee_name} ${r.date ?? ""}`,
                        })
                      }
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Leave / WFH-request approvals (LeaveRequest table).
       *  The WFH section above covers punch-based WFH on the Attendance
       *  side; this one covers future-dated WFH and Leave filed through
       *  the LeaveRequest pipeline. They share an approval queue here so
       *  managers see a single list of "things waiting on me". */}
      <section style={sectionCard}>
        <div style={sectionHeader}>Leave/WFH requests ({pendingLeave.length})</div>
        {leave.loading && <div style={empty}>Loading…</div>}
        {!leave.loading && pendingLeave.length === 0 && (
          <div style={empty}>Nothing pending.</div>
        )}
        {pendingLeave.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Employee</th>
                <th style={{ ...head, width: 70 }}>Type</th>
                <th style={head}>From → To</th>
                <th style={{ ...head, width: 60, textAlign: "right" }}>Days</th>
                <th style={head}>Reason</th>
                <th style={{ ...head, width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingLeave.map((l) => {
                const isWfh = l.request_type === "WFH";
                return (
                  <tr key={l.id}>
                    <td style={cell}>{l.user_name}</td>
                    <td style={cell}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 700,
                          background: isWfh ? "#dbeafe" : "#fef9c3",
                          color: isWfh ? "#1e40af" : "#854d0e",
                        }}
                      >
                        {l.request_type}
                      </span>
                    </td>
                    <td style={cell}>
                      {fmtDate(l.from_date)} ({l.from_session}) → {fmtDate(l.to_date)} ({l.to_session})
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>{l.total_days}</td>
                    <td style={cell}>{l.reason}</td>
                    <td style={cell}>
                      <button
                        style={btnApprove}
                        disabled={busyId === l.id}
                        onClick={() => {
                          void handleApproveLeave(l.id);
                        }}
                      >
                        Approve
                      </button>
                      <button
                        style={btnReject}
                        disabled={busyId === l.id}
                        onClick={() =>
                          setRejectTarget({
                            kind: "leave",
                            uid: l.id,
                            label: `${l.request_type} ${l.user_name} ${l.from_date} → ${l.to_date}`,
                          })
                        }
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <RejectModal
        open={rejectTarget !== null}
        title={rejectTarget ? `Reject — ${rejectTarget.label}` : ""}
        onClose={() => setRejectTarget(null)}
        onSubmit={handleRejectSubmit}
      />
    </div>
  );
}
