import ModalWrap from "@/components/ui/ModalWrap";
import MemberList from "@/components/ui/MemberList";

export interface NewGroupModalProps {
  grpName: string;
  setGrpName: (name: string) => void;
  grpMembers: string[];
  setGrpMembers: React.Dispatch<React.SetStateAction<string[]>>;
  otherUsers: Array<{ id: string; full_name?: string; name?: string }>;
  onClose: () => void;
  onCreate: () => void;
  toggleMember: (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
  ) => void;
}

export default function NewGroupModal({
  grpName,
  setGrpName,
  grpMembers,
  setGrpMembers,
  otherUsers,
  onClose,
  onCreate,
  toggleMember,
}: NewGroupModalProps) {
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
        👥 Create Group Chat
      </div>
      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#475569",
            display: "block",
            marginBottom: 4,
          }}
        >
          Group Name *
        </label>
        <input
          value={grpName}
          onChange={(e) => setGrpName(e.target.value)}
          placeholder="e.g. Finance Team, Project Alpha…"
          autoFocus
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13,
            boxSizing: "border-box",
            outline: "none",
          }}
        />
      </div>
      <div
        style={{
          marginBottom: 12,
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
        <MemberList
          available={otherUsers}
          selected={grpMembers}
          onToggle={(id) => toggleMember(setGrpMembers, id)}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
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
        <button
          onClick={onCreate}
          style={{
            flex: 1,
            padding: "8px 0",
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
    </ModalWrap>
  );
}
