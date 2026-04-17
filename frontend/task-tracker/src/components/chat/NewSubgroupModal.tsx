import ModalWrap from "@/components/ui/ModalWrap";
import MemberList from "@/components/ui/MemberList";
import type { ChatRoom } from "@/types";

export interface NewSubgroupModalProps {
  subName: string;
  setSubName: (name: string) => void;
  subMembers: string[];
  setSubMembers: React.Dispatch<React.SetStateAction<string[]>>;
  parentMembers: Array<{ id: string; full_name?: string; name?: string }>;
  activeRoom: ChatRoom | null;
  onClose: () => void;
  onCreate: () => void;
  toggleMember: (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
  ) => void;
}

export default function NewSubgroupModal({
  subName,
  setSubName,
  subMembers,
  setSubMembers,
  parentMembers,
  activeRoom,
  onClose,
  onCreate,
  toggleMember,
}: NewSubgroupModalProps) {
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
        ⤷ Create Subgroup
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
        Under: <b style={{ color: "#7c3aed" }}>{activeRoom?.displayName}</b> ·
        Only this group's members can be added.
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
          Subgroup Name *
        </label>
        <input
          value={subName}
          onChange={(e) => setSubName(e.target.value)}
          placeholder="e.g. Tax Filing, Q1 Audit…"
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
          Select Members * ({subMembers.length} selected)
        </label>
        <MemberList
          available={parentMembers}
          selected={subMembers}
          onToggle={(id) => toggleMember(setSubMembers, id)}
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
          Create Subgroup
        </button>
      </div>
    </ModalWrap>
  );
}
