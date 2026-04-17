import type { Task, TaskLogEntry } from "@/types";

export interface TaskLogModalProps {
  task: Task | null;
  entries: TaskLogEntry[];
  onClose: () => void;
}

export default function TaskLogModal({
  task,
  entries,
  onClose,
}: TaskLogModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 620,
          maxWidth: "95vw",
          maxHeight: "80vh",
          borderRadius: 14,
          overflowY: "auto",
          background: "var(--modal-bg)",
          boxShadow: "0 12px 48px rgba(0,0,0,.35)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "18px 24px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "var(--txt3)",
                marginBottom: 4,
              }}
            >
              Edit Log
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--txt)" }}>
              {task?.description || "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
              color: "var(--txt3)",
              lineHeight: 1,
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "16px 24px 24px" }}>
          {entries.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--txt3)",
                padding: "40px 0",
                fontSize: 14,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              No edits recorded yet
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 14,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "#2563eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {entry.changed_by_name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--txt)",
                        fontSize: 13,
                      }}
                    >
                      {entry.changed_by_name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--txt3)",
                      background: "var(--border)",
                      padding: "2px 8px",
                      borderRadius: 20,
                    }}
                  >
                    {new Date(entry.changed_at).toLocaleString("en-GB")}
                  </span>
                </div>
                <div style={{ marginLeft: 38 }}>
                  {(entry.changes || []).map((c, j) => (
                    <div
                      key={j}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        color: "var(--txt2)",
                        marginBottom: 5,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--txt3)",
                          minWidth: 90,
                        }}
                      >
                        {c.field}
                      </span>
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#dc2626",
                          padding: "1px 7px",
                          borderRadius: 4,
                          textDecoration: "line-through",
                          fontSize: 12,
                        }}
                      >
                        {c.from || "—"}
                      </span>
                      <span style={{ color: "var(--txt3)" }}>→</span>
                      <span
                        style={{
                          background: "#dcfce7",
                          color: "#16a34a",
                          padding: "1px 7px",
                          borderRadius: 4,
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {c.to || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
