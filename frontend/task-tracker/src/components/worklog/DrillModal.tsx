import type { WorkLog } from "@/types";
import { fromMins, toMins } from "@/utils/time";
import { getPr } from "@/utils/worklog";

interface DrillModalProps {
  title: string;
  rows: WorkLog[];
  onClose: () => void;
}

export default function DrillModal({ title, rows, onClose }: DrillModalProps) {
  const totalMins = rows.reduce((s, r) => s + toMins(r.hours_worked), 0);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "90vw",
          maxWidth: 860,
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
            <span style={{ fontSize: 13, color: "#64748b", marginLeft: 8 }}>
              {rows.length} entries ·{" "}
              <span style={{ color: "#2563eb", fontWeight: 700 }}>
                {fromMins(totalMins)} hrs
              </span>
            </span>
          </div>
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
        {/* Table */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: 32 }}>
              No entries.
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f8fafc",
                  zIndex: 1,
                }}
              >
                <tr>
                  {[
                    "#",
                    "Name",
                    "Date",
                    "Client",
                    "Task Description",
                    "Hours",
                    "Priority",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px",
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
                {rows.map((r, i) => {
                  const pr = getPr(r.priority);
                  return (
                    <tr
                      key={r.id || i}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: i % 2 === 0 ? "#fff" : "#fafafa",
                      }}
                    >
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#94a3b8",
                          fontSize: 12,
                        }}
                      >
                        {i + 1}
                      </td>
                      <td style={{ padding: "7px 12px", fontWeight: 600 }}>
                        {r.name}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.date}{" "}
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          ({r.day})
                        </span>
                      </td>
                      <td style={{ padding: "7px 12px" }}>
                        {r.client ? (
                          <span
                            style={{
                              background: "#eff6ff",
                              color: "#2563eb",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {r.client}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "7px 12px", minWidth: 200 }}>
                        {r.task_description}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          fontWeight: 700,
                          color: "#2563eb",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.hours_worked || "—"}
                      </td>
                      <td style={{ padding: "7px 12px" }}>
                        <span
                          style={{
                            background: pr.badgeBg,
                            color: pr.badge,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {r.priority || "Normal"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
