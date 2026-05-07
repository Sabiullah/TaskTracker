import type { CSSProperties } from "react";
import { fmtDate } from "@/utils/date";
import { fmtMoney } from "@/utils/money";
import { isOverdue, priorityStyle } from "@/utils/leads";
import type { Lead, LeadStatusRecord } from "@/types";

export interface LeadsTableProps {
  leads: Lead[];
  statuses: LeadStatusRecord[];
  loading: boolean;
  canDelete: boolean;
  statusBadge: (name: string) => CSSProperties;
  onEdit: (lead: Lead) => void;
  onHistory: (lead: Lead) => void;
  onAttachments: (lead: Lead) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, statusName: string) => void;
}

export default function LeadsTable({
  leads,
  statuses,
  loading,
  canDelete,
  statusBadge,
  onEdit,
  onHistory,
  onAttachments,
  onDelete,
  onStatusChange,
}: LeadsTableProps) {
  if (loading) {
    return (
      <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>
        Loading…
      </div>
    );
  }
  if (leads.length === 0) {
    return (
      <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>
        No leads found. Click <b>+ New Lead</b> to add one.
      </div>
    );
  }

  return (
    <div className="sticky-table-wrap">
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {[
              "#",
              "Client",
              "Contact",
              "Lead Source / Ref",
              "Assigned To",
              "Status",
              "Priority",
              "Action Taken",
              "Next Step",
              "Next Step Date",
              "Est. Value",
              "Remarks",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "9px 10px",
                  textAlign: "left",
                  fontWeight: 700,
                  color: "#475569",
                  fontSize: 12,
                  borderBottom: "2px solid #e2e8f0",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const overdue =
              isOverdue(l.next_step_date) &&
              !["confirmed", "cancelled"].includes(
                (l.status || "").toLowerCase(),
              );
            return (
              <tr
                key={l.id}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  background: overdue ? "#fff7ed" : "white",
                  verticalAlign: "top",
                }}
              >
                <td
                  style={{
                    padding: "7px 10px",
                    color: "#94a3b8",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.serialNo}
                </td>
                <td style={{ padding: "7px 10px", minWidth: 130 }}>
                  <div style={{ fontWeight: 700, color: "#1e293b" }}>
                    {l.client}
                  </div>
                  {l.contact_person && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {l.contact_person}
                    </div>
                  )}
                  {l.contact_phone && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      📞 {l.contact_phone}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#64748b",
                    minWidth: 120,
                  }}
                >
                  {l.contact_email || "—"}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#64748b",
                    minWidth: 130,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{l.lead_source || "—"}</div>
                  {l.reference_from && (
                    <div style={{ fontSize: 11 }}>via {l.reference_from}</div>
                  )}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#475569",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.assigned_to || "—"}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    whiteSpace: "nowrap",
                    minWidth: 150,
                  }}
                >
                  <select
                    value={l.status || ""}
                    onChange={(e) => onStatusChange(l.id, e.target.value)}
                    style={{
                      ...statusBadge(l.status),
                      border: "none",
                      cursor: "pointer",
                      outline: "none",
                      minWidth: 130,
                      width: "100%",
                    }}
                  >
                    {statuses.map((s) => (
                      <option key={s.id || s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                  <span style={priorityStyle(l.priority)}>{l.priority}</span>
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#64748b",
                    minWidth: 160,
                    maxWidth: 220,
                  }}
                >
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {l.action_taken || "—"}
                  </div>
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#475569",
                    minWidth: 160,
                    maxWidth: 220,
                  }}
                >
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {l.next_step || "—"}
                  </div>
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    color: overdue ? "#dc2626" : "#64748b",
                    fontWeight: overdue ? 700 : 400,
                  }}
                >
                  {fmtDate(l.next_step_date)} {overdue ? "⚠️" : ""}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#16a34a",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtMoney(
                    l.estimated_value != null
                      ? Number(l.estimated_value)
                      : null,
                  )}
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    color: "#64748b",
                    minWidth: 140,
                  }}
                >
                  {l.remarks || "—"}
                </td>
                <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => onHistory(l)}
                      title="Follow-up log"
                      style={{
                        padding: "4px 8px",
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        borderRadius: 5,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      📋
                    </button>
                    <button
                      onClick={() => onAttachments(l)}
                      title={`Attachments${l.attachments?.length ? ` (${l.attachments.length})` : ""}`}
                      style={{
                        padding: "4px 8px",
                        border: "1px solid #e9d5ff",
                        background: "#faf5ff",
                        borderRadius: 5,
                        cursor: "pointer",
                        fontSize: 12,
                        position: "relative",
                      }}
                    >
                      📎
                      {l.attachments && l.attachments.length > 0 && (
                        <span
                          style={{
                            marginLeft: 3,
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#7c3aed",
                          }}
                        >
                          {l.attachments.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => onEdit(l)}
                      title="Edit"
                      style={{
                        padding: "4px 8px",
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc",
                        borderRadius: 5,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      ✏️
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => onDelete(l.id)}
                        title="Delete"
                        style={{
                          padding: "4px 8px",
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          borderRadius: 5,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
