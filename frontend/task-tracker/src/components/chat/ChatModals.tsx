import { avatarColor, initials } from "@/utils/avatar";
import type { Profile } from "@/types";

export interface ChatModalsProps {
  showNewDM: boolean;
  showNewGrp: boolean;
  otherUsers: Profile[];
  grpName: string;
  grpMembers: string[];
  onCreateDM: (userId: string) => void;
  onCreateGroup: () => void;
  onCloseDM: () => void;
  onCloseGrp: () => void;
  onGrpNameChange: (name: string) => void;
  onToggleGrpMember: (id: string) => void;
}

export default function ChatModals({
  showNewDM,
  showNewGrp,
  otherUsers,
  grpName,
  grpMembers,
  onCreateDM,
  onCreateGroup,
  onCloseDM,
  onCloseGrp,
  onGrpNameChange,
  onToggleGrpMember,
}: ChatModalsProps) {
  return (
    <>
      {showNewDM && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && onCloseDM()}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 24,
              width: 380,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 40px rgba(0,0,0,.2)",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                marginBottom: 14,
                color: "#1e293b",
              }}
            >
              💬 New Direct Message
            </div>
            <div
              style={{
                overflowY: "auto",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {otherUsers.length === 0 ? (
                <div
                  style={{ color: "#94a3b8", textAlign: "center", padding: 20 }}
                >
                  No other users found.
                </div>
              ) : (
                otherUsers.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onCreateDM(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      border: "1.5px solid #e2e8f0",
                      background: "#f8fafc",
                      transition: "all .12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#eff6ff";
                      e.currentTarget.style.borderColor = "#93c5fd";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#f8fafc";
                      e.currentTarget.style.borderColor = "#e2e8f0";
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        background: avatarColor(p.full_name || ""),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {initials(p.full_name || "")}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "#1e293b",
                        }}
                      >
                        {p.full_name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          textTransform: "capitalize",
                        }}
                      >
                        {p.role}
                      </div>
                    </div>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#2563eb",
                        fontWeight: 600,
                      }}
                    >
                      Chat →
                    </span>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={onCloseDM}
              style={{
                marginTop: 14,
                padding: "9px 0",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                background: "#f8fafc",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                color: "#64748b",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showNewGrp && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && onCloseGrp()}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 24,
              width: 420,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 40px rgba(0,0,0,.2)",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                marginBottom: 16,
                color: "#1e293b",
              }}
            >
              👥 Create Group Chat
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 5,
                }}
              >
                Group Name *
              </label>
              <input
                value={grpName}
                onChange={(e) => onGrpNameChange(e.target.value)}
                placeholder="e.g. Finance Team, Project Alpha…"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 7,
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>
            <div
              style={{
                marginBottom: 16,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Select Members * ({grpMembers.length} selected)
              </label>
              <div
                style={{
                  overflowY: "auto",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {otherUsers.map((p) => {
                  const checked = grpMembers.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        border: `1.5px solid ${checked ? "#2563eb" : "#e2e8f0"}`,
                        background: checked ? "#eff6ff" : "#f8fafc",
                        transition: "all .12s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleGrpMember(p.id)}
                        style={{
                          accentColor: "#2563eb",
                          width: 16,
                          height: 16,
                        }}
                      />
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: avatarColor(p.full_name || ""),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {initials(p.full_name || "")}
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: "#1e293b",
                          }}
                        >
                          {p.full_name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
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
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={onCloseGrp}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  background: "#f8fafc",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={onCreateGroup}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
