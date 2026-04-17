import { avatarColor, initials } from "@/utils/avatar";
import type { ID } from "@/types";

interface MemberItem {
  id: ID;
  full_name?: string;
  name?: string;
  role?: string;
}

export interface MemberListProps {
  available: MemberItem[];
  selected: ID[];
  onToggle: (id: ID) => void;
}

export default function MemberList({
  available,
  selected,
  onToggle,
}: MemberListProps) {
  return (
    <div
      style={{
        overflowY: "auto",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      {available.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 12, padding: 10 }}>
          No members available.
        </div>
      ) : (
        available.map((p) => {
          const checked = selected.includes(p.id);
          const displayName = p.full_name || p.name || "";
          return (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                border: `1.5px solid ${checked ? "#2563eb" : "#e2e8f0"}`,
                background: checked ? "#eff6ff" : "#f8fafc",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(p.id)}
                style={{ accentColor: "#2563eb", width: 15, height: 15 }}
              />
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: avatarColor(displayName),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {initials(displayName)}
              </div>
              <div>
                <div
                  style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#94a3b8",
                    textTransform: "capitalize",
                  }}
                >
                  {p.role}
                </div>
              </div>
              {checked && (
                <span
                  style={{
                    marginLeft: "auto",
                    color: "#2563eb",
                    fontWeight: 700,
                  }}
                >
                  ✓
                </span>
              )}
            </label>
          );
        })
      )}
    </div>
  );
}
