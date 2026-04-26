import type { Dispatch, SetStateAction } from "react";
import { STATUS_CFG, thS, tdS } from "@/utils/attendance";
import { fmtClockTime as fmtTime } from "@/utils/time";
import { fmtDate, getDayName } from "@/utils/date";
import EditRow from "./EditRow";
import type { AttendanceRecord } from "@/types";

interface Props {
  loading: boolean;
  filtered: AttendanceRecord[];
  addRow: Partial<AttendanceRecord> | null;
  setAddRow: Dispatch<SetStateAction<Partial<AttendanceRecord> | null>>;
  editId: string | null;
  editForm: Partial<AttendanceRecord>;
  setEditForm: Dispatch<SetStateAction<Partial<AttendanceRecord>>>;
  saving: boolean;
  deleting: string | null;
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
  visibleMembers: string[];
  minBackdate: string | undefined;
  onSave: (form: Partial<AttendanceRecord>, id?: string | null) => void;
  onDelete: (id: string) => void;
  onStartEdit: (r: AttendanceRecord) => void;
  onCancelAll: () => void;
}

export default function AttendanceLogTab({
  loading,
  filtered,
  addRow,
  setAddRow,
  editId,
  editForm,
  setEditForm,
  saving,
  deleting,
  isAdmin,
  isManager,
  myName,
  visibleMembers,
  minBackdate,
  onSave,
  onDelete,
  onStartEdit,
  onCancelAll,
}: Props) {
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
        Loading…
      </div>
    );
  }

  const showEmpCol = isAdmin || isManager;

  return (
    <div
      className="sticky-table-wrap dm-box"
      style={{
        background: "#fff",
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 4px rgba(0,0,0,.06)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...thS, width: 36 }}>#</th>
            {showEmpCol && <th style={{ ...thS, minWidth: 130 }}>Employee</th>}
            <th style={{ ...thS, width: 110 }}>Date</th>
            <th style={{ ...thS, width: 50 }}>Day</th>
            <th style={{ ...thS, width: 80 }}>Login</th>
            <th style={{ ...thS, width: 80 }}>Logout</th>
            <th style={{ ...thS, width: 110 }}>Location</th>
            <th style={{ ...thS, width: 100 }}>Status</th>
            <th style={{ ...thS, minWidth: 120 }}>Remarks</th>
            <th style={{ ...thS, width: 80 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {addRow && (
            <EditRow
              form={addRow}
              onChange={(patch) =>
                setAddRow((f) => ({ ...(f ?? {}), ...patch }))
              }
              isNew
              onSave={() => onSave(addRow)}
              onCancel={onCancelAll}
              saving={saving}
              isAdmin={showEmpCol}
              canEditTiming={isAdmin}
              memberOptions={visibleMembers}
              minDate={isAdmin ? undefined : minBackdate}
            />
          )}
          {filtered.length === 0 && !addRow && (
            <tr>
              <td
                colSpan={showEmpCol ? 10 : 9}
                style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}
              >
                No attendance records found.
              </td>
            </tr>
          )}
          {filtered.map((r, i) => {
            if (editId === r.id) {
              return (
                <EditRow
                  key={r.id}
                  form={editForm}
                  onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                  onSave={() => onSave(editForm, r.id)}
                  onCancel={onCancelAll}
                  saving={saving}
                  isAdmin={showEmpCol}
                  canEditTiming={isAdmin}
                  memberOptions={visibleMembers}
                  minDate={isAdmin ? undefined : minBackdate}
                />
              );
            }
            const sc = STATUS_CFG[r.status] ?? STATUS_CFG["Present"];
            const canEdit = isAdmin || isManager || r.employee_name === myName;
            return (
              <tr
                key={r.id}
                style={{ transition: "background .12s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <td style={{ ...tdS, color: "#94a3b8", fontWeight: 600, fontSize: 11 }}>{i + 1}</td>
                {showEmpCol && (
                  <td style={{ ...tdS, fontWeight: 600, color: "#1e293b" }}>{r.employee_name}</td>
                )}
                <td style={{ ...tdS, fontSize: 12 }}>{fmtDate(r.date)}</td>
                <td style={{ ...tdS, fontSize: 11, color: "#94a3b8" }}>{getDayName(r.date)}</td>
                <td style={{ ...tdS, fontSize: 12, fontWeight: 600 }}>{fmtTime(r.login_time)}</td>
                <td style={{ ...tdS, fontSize: 12, fontWeight: 600 }}>{fmtTime(r.logout_time)}</td>
                <td style={{ ...tdS, fontSize: 12 }}>
                  <span style={{ padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#475569" }}>
                    {r.work_location || "—"}
                  </span>
                </td>
                <td style={tdS}>
                  <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color }}>
                    {sc.icon} {r.status}
                  </span>
                </td>
                <td style={{ ...tdS, fontSize: 12, color: "#64748b" }}>{r.remarks || "—"}</td>
                <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <>
                      <button onClick={() => onStartEdit(r)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✏️</button>
                      {isAdmin && (
                        <button onClick={() => onDelete(r.id)} title="Delete" disabled={deleting === r.id} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 4px", opacity: deleting === r.id ? 0.5 : 1 }}>🗑️</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
