import ModalWrap from "@/components/ui/ModalWrap";
import AvatarDiv from "@/components/ui/AvatarDiv";

export interface NewDMModalProps {
  otherUsers: Array<{
    id: string;
    full_name?: string;
    name?: string;
    role?: string;
  }>;
  onClose: () => void;
  onCreateDM: (userId: string) => void;
}

export default function NewDMModal({
  otherUsers,
  onClose,
  onCreateDM,
}: NewDMModalProps) {
  return (
    <ModalWrap onClose={onClose}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 15,
          marginBottom: 12,
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
        {otherUsers.map((p) => (
          <div
            key={p.id}
            onClick={() => onCreateDM(p.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 9,
              cursor: "pointer",
              border: "1.5px solid #e2e8f0",
              background: "#f8fafc",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "#eff6ff";
              (e.currentTarget as HTMLDivElement).style.borderColor = "#93c5fd";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "#f8fafc";
              (e.currentTarget as HTMLDivElement).style.borderColor = "#e2e8f0";
            }}
          >
            <AvatarDiv name={p.full_name || p.name || ""} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {p.full_name || p.name}
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
        ))}
      </div>
      <button
        onClick={onClose}
        style={{
          marginTop: 12,
          padding: "8px 0",
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
    </ModalWrap>
  );
}
