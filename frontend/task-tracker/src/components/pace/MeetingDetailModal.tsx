import { fmtClockTime as fmtTime } from "@/utils/time";
import { fmtDate } from "@/utils/date";
import type { PaceMeetingDto } from "@/types/api";
import { TYPE_CFG, thS, tdS } from "@/utils/paceMeetings";

export interface MeetingDetailModalProps {
  meeting: PaceMeetingDto;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}

export function MeetingDetailModal({
  meeting,
  canEdit,
  onEdit,
  onClose,
}: MeetingDetailModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(3px)",
      }}
      onClick={onClose}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 700,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 24px 14px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
            borderRadius: "14px 14px 0 0",
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 10,
                background: TYPE_CFG[meeting.meeting_type]?.bg,
                color: TYPE_CFG[meeting.meeting_type]?.color,
                marginRight: 8,
              }}
            >
              {TYPE_CFG[meeting.meeting_type]?.icon} {meeting.meeting_type}
            </span>
            <span
              style={{
                fontWeight: 800,
                fontSize: 18,
                fontFamily: "var(--font-heading)",
                color: "var(--txt)",
              }}
            >
              {meeting.title}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {canEdit && (
              <button
                onClick={onEdit}
                style={{
                  padding: "6px 12px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ✏️ Edit
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#64748b",
              }}
            >
              ✕
            </button>
          </div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: 13,
              color: "#475569",
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <span>📅 {fmtDate(meeting.scheduled_date)}</span>
            <span>🕐 {fmtTime(meeting.scheduled_time) || "—"}</span>
            <span>⏱ {meeting.duration_minutes} min</span>
            <span>🎤 Led by: {meeting.conducted_by || "—"}</span>
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#2563eb",
              marginBottom: 8,
            }}
          >
            📋 Agenda
          </div>
          <pre
            style={{
              background: "#f8fafc",
              padding: 14,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-body)",
              marginBottom: 16,
              border: "1px solid #e2e8f0",
              color: "#374151",
            }}
          >
            {meeting.agenda || "—"}
          </pre>
          {meeting.minutes && (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#16a34a",
                  marginBottom: 8,
                }}
              >
                📝 Minutes
              </div>
              <pre
                style={{
                  background: "#f0fdf4",
                  padding: 14,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-body)",
                  marginBottom: 16,
                  border: "1px solid #86efac",
                  color: "#374151",
                }}
              >
                {meeting.minutes}
              </pre>
            </>
          )}
          {(meeting.action_items || []).length > 0 && (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#dc2626",
                  marginBottom: 8,
                }}
              >
                ⚡ Action Items
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                <thead>
                  <tr>
                    <th style={thS}>#</th>
                    <th style={thS}>Task</th>
                    <th style={thS}>Assignee</th>
                    <th style={thS}>Due</th>
                    <th style={thS}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {meeting.action_items.map((a, i) => (
                    <tr key={i}>
                      <td style={tdS}>{i + 1}</td>
                      <td style={tdS}>{a.task}</td>
                      <td style={tdS}>{a.assignee}</td>
                      <td style={tdS}>{fmtDate(a.due_date)}</td>
                      <td style={tdS}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 10,
                            fontWeight: 700,
                            background:
                              a.status === "Done" ? "#f0fdf4" : "#fef3c7",
                            color:
                              a.status === "Done" ? "#16a34a" : "#d97706",
                          }}
                        >
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#475569",
              marginBottom: 8,
            }}
          >
            👥 Attendees
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(meeting.attendees || []).map((a) => (
              <span
                key={a}
                style={{
                  padding: "3px 10px",
                  borderRadius: 12,
                  background: "#f1f5f9",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#475569",
                }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
