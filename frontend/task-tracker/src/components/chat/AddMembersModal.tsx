import ModalWrap from "@/components/ui/ModalWrap";
import MemberList from "@/components/ui/MemberList";
import type { ChatRoom } from "@/types";

export interface AddMembersModalProps {
  addMembers: string[];
  setAddMembers: React.Dispatch<React.SetStateAction<string[]>>;
  nonMembers: Array<{ id: string; full_name?: string; name?: string }>;
  activeRoom: ChatRoom | null;
  onClose: () => void;
  onAdd: () => void;
  toggleMember: (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
  ) => void;
}

export default function AddMembersModal({
  addMembers,
  setAddMembers,
  nonMembers,
  activeRoom,
  onClose,
  onAdd,
  toggleMember,
}: AddMembersModalProps) {
  return (
    <ModalWrap onClose={onClose}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 15,
          marginBottom: 4,
          color: "#1e293b",
        }}
      >
        ➕ Add Members
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
        To: <b style={{ color: "#16a34a" }}>{activeRoom?.displayName}</b>
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
          {nonMembers.length === 0
            ? "All employees are already in this group."
            : `Select people to add (${addMembers.length} selected)`}
        </label>
        <MemberList
          available={nonMembers}
          selected={addMembers}
          onToggle={(id) => toggleMember(setAddMembers, id)}
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
          onClick={onAdd}
          disabled={nonMembers.length === 0}
          style={{
            flex: 1,
            padding: "8px 0",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
            opacity: nonMembers.length === 0 ? 0.5 : 1,
          }}
        >
          Add Members
        </button>
      </div>
    </ModalWrap>
  );
}
