import { useState } from "react";

export interface RosterMembership {
  membership_uid: string;
  user_uid: string;
  user_name: string;
  excluded: boolean;
}

export interface RosterExcludePanelProps {
  memberships: RosterMembership[];
  onToggle: (membershipUid: string, nextExcluded: boolean) => void;
}

export function RosterExcludePanel({ memberships, onToggle }: RosterExcludePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "#f8fafc",
          border: "none",
          borderRadius: 8,
          textAlign: "left",
          cursor: "pointer",
          fontWeight: 700,
          fontSize: 12,
          color: "#475569",
        }}
      >
        {open ? "▾" : "▸"} Roster settings — exclude members from the standup grid
      </button>
      {open && (
        <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {memberships.map((m) => (
            <label
              key={m.membership_uid}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
                fontSize: 12,
                background: m.excluded ? "#fef3c7" : "#f8fafc",
              }}
            >
              <input
                type="checkbox"
                aria-label={m.user_name}
                checked={m.excluded}
                onChange={(e) => onToggle(m.membership_uid, e.target.checked)}
              />
              <span>{m.user_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
