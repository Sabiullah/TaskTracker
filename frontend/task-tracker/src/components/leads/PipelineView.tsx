import { hexBg, isOverdue, priorityStyle } from "@/utils/leads";
import { fmtDateShort } from "@/utils/date";
import { fmtMoney } from "@/utils/money";
import type { Lead, LeadStatusRecord } from "@/types";

interface PipelineViewProps {
  leads: Lead[];
  statuses: LeadStatusRecord[];
  onEdit: (lead: Lead) => void;
}

export default function PipelineView({
  leads,
  statuses,
  onEdit,
}: PipelineViewProps) {
  return (
    <div
      style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}
    >
      {statuses.map((st) => {
        const col = leads.filter((l) => l.status === st.name);
        const total = col.reduce(
          (s, l) => s + (Number(l.estimated_value) || 0),
          0,
        );
        const bg = hexBg(st.color);
        return (
          <div
            key={st.id || st.name}
            style={{ minWidth: 240, flex: "0 0 240px" }}
          >
            <div
              style={{
                background: bg,
                border: `2px solid ${st.color}40`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{ fontWeight: 700, color: st.color, fontSize: 13 }}
                >
                  {st.name}
                </span>
                <span
                  style={{
                    background: st.color,
                    color: "#fff",
                    borderRadius: 12,
                    padding: "1px 9px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {col.length}
                </span>
              </div>
              {total > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: st.color,
                    marginTop: 2,
                    opacity: 0.8,
                  }}
                >
                  {fmtMoney(total)}
                </div>
              )}
            </div>
            {col.map((l) => (
              <div
                key={l.id}
                onClick={() => onEdit(l)}
                style={{
                  background: "#fff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 9,
                  padding: "10px 12px",
                  marginBottom: 8,
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.boxShadow =
                    "0 3px 12px rgba(0,0,0,.12)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.boxShadow =
                    "0 1px 3px rgba(0,0,0,.06)")
                }
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#1e293b",
                    marginBottom: 4,
                  }}
                >
                  {l.client}
                </div>
                {l.contact_person && (
                  <div
                    style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}
                  >
                    👤 {l.contact_person}
                  </div>
                )}
                {l.assigned_to && (
                  <div
                    style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}
                  >
                    🧑 {l.assigned_to}
                  </div>
                )}
                {l.next_step_date && (
                  <div
                    style={{
                      fontSize: 11,
                      color: isOverdue(l.next_step_date)
                        ? "#dc2626"
                        : "#64748b",
                      marginBottom: 2,
                    }}
                  >
                    🗓 {fmtDateShort(l.next_step_date)}{" "}
                    {isOverdue(l.next_step_date) ? "⚠️" : ""}
                  </div>
                )}
                {(l.estimated_value ?? 0) > 0 && (
                  <div
                    style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}
                  >
                    {fmtMoney(Number(l.estimated_value))}
                  </div>
                )}
                <div style={{ marginTop: 5 }}>
                  <span style={priorityStyle(l.priority)}>{l.priority}</span>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
