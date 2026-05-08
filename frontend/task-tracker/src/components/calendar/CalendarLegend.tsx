import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";

interface CalendarLegendProps {
  showTasks: boolean;
  showPlans: boolean;
  /** Member names → palette index, used so colours match cell chips. */
  empColorMap: Record<string, MemberPalette>;
  /** Members that actually have plans visible, alphabetically. */
  activeMembers: string[];
}

export default function CalendarLegend({
  showTasks,
  showPlans,
  empColorMap,
  activeMembers,
}: CalendarLegendProps) {
  if (!showTasks && !showPlans) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 12,
      }}
    >
      {showTasks && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {COLUMNS.map((c) => (
            <span
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                color: "#1e293b",
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: c.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {c.title}
            </span>
          ))}
          <span style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>
            ⟳ = Recurring
          </span>
        </div>
      )}

      {showPlans && activeMembers.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "6px 10px",
            background: "#f8fafc",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginRight: 4,
            }}
          >
            LEGEND:
          </span>
          {activeMembers.map((n) => {
            const c = empColorMap[n] || EMP_COLORS[0];
            return (
              <span
                key={n}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1.5px solid ${c.dot}`,
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                {n}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
