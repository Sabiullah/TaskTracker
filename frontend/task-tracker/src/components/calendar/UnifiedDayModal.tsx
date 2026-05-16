import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import { toMins, fromMins } from "@/utils/time";
import type { Task, WorkPlan } from "@/types";
import type { ID } from "@/types/common";

interface UnifiedDayModalProps {
  dateLabel: string; // e.g. "8 May 2026"
  tasks: Task[];
  plans: WorkPlan[];
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  mainsById: Map<ID, { description: string }>;
  onClose: () => void;
}

export default function UnifiedDayModal({
  dateLabel,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  mainsById,
  onClose,
}: UnifiedDayModalProps) {
  const renderTasks = showTasks && tasks.length > 0;
  const renderPlans = showPlans && plans.length > 0;
  const totalPlanMins = plans.reduce(
    (s, p) => s + toMins(p.hours_planned),
    0,
  );

  // Summary counts only the sections that actually render.
  const summaryParts: string[] = [];
  if (renderTasks) summaryParts.push(`${tasks.length} task${tasks.length !== 1 ? "s" : ""}`);
  if (renderPlans) summaryParts.push(`${plans.length} plan${plans.length !== 1 ? "s" : ""}`);
  if (renderPlans) summaryParts.push(`${fromMins(totalPlanMins)} planned hrs`);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          width: 560,
          maxWidth: "94vw",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
              📅 {dateLabel}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {summaryParts.join(" · ")}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#64748b",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {renderTasks && (
            <section>
              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#475569",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Tasks ({tasks.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tasks.map((t, i) => {
                  const col = COLUMNS.find((c) => c.id === t.status);
                  const isRec = t.recurrence && t.recurrence !== "Onetime";
                  const parent = t.parentId ? mainsById.get(t.parentId) : null;
                  return (
                    <div
                      key={t.id + "-tm-" + i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        padding: "10px 12px",
                        borderLeft: `4px solid ${col?.color || "#888"}`,
                        background: "#fafafa",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            background: col?.color || "#888",
                            color: "#fff",
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          {t.status}
                        </span>
                        {isRec && (
                          <span
                            style={{
                              background: "#ede9fe",
                              color: "#7c3aed",
                              fontSize: 10,
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontWeight: 600,
                            }}
                          >
                            ⟳ {t.recurrence}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginLeft: "auto",
                          }}
                        >
                          {t.client}
                        </span>
                      </div>
                      {parent && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginBottom: 2,
                          }}
                        >
                          Part of:{" "}
                          <strong style={{ color: "#475569" }}>
                            {parent.description}
                          </strong>
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1e293b",
                          marginBottom: 2,
                        }}
                      >
                        {t.description}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          fontSize: 11,
                          color: "#64748b",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>👤 {t.responsible}</span>
                        <span>🏷 {t.category}</span>
                        {t.remarks && <span>💬 {t.remarks}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {renderPlans && (
            <section>
              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#475569",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Work Plans ({plans.length} · {fromMins(totalPlanMins)} hrs)
              </h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                  gap: 10,
                }}
              >
                {plans.map((p, i) => {
                  const c = empColorMap[p.name] || EMP_COLORS[0];
                  const initials = (p.name || "?")
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <div
                      key={p.id + "-pm-" + i}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: c.bg,
                        border: `1.5px solid ${c.dot}`,
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: c.dot,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: c.text,
                            fontSize: 13,
                          }}
                        >
                          {p.name}
                        </div>
                        {p.client && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#475569",
                              marginTop: 3,
                            }}
                          >
                            🏢 {p.client}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: 12,
                            color: "#374151",
                            marginTop: 4,
                            lineHeight: 1.4,
                          }}
                        >
                          📋 {p.task_description}
                        </div>
                        {p.hours_planned && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#2563eb",
                              marginTop: 4,
                              fontWeight: 700,
                            }}
                          >
                            ⏱ {p.hours_planned} hrs
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {!renderTasks && !renderPlans && (
            <p
              style={{
                color: "#94a3b8",
                fontSize: 13,
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              Nothing scheduled for this day.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
