import RoomRow from "./RoomRow";
import type { Profile, ChatRoom } from "@/types";

export interface ChatSidebarProps {
  topLevel: ChatRoom[];
  subMap: Record<string, ChatRoom[]>;
  activeRoom: ChatRoom | null;
  profileMap: Record<string, Profile>;
  expandedGroups: Set<string>;
  sideSearch: string;
  totalUnread: number;
  onRoomClick: (room: ChatRoom, subMap?: Record<string, ChatRoom[]>) => void;
  onToggleExpand: (roomId: string) => void;
  onSearchChange: (v: string) => void;
  onClose: () => void;
  onNewDM: () => void;
  onNewGroup: () => void;
}

export default function ChatSidebar({
  topLevel,
  subMap,
  activeRoom,
  profileMap,
  expandedGroups,
  sideSearch,
  totalUnread,
  onRoomClick,
  onToggleExpand,
  onSearchChange,
  onClose,
  onNewDM,
  onNewGroup,
}: ChatSidebarProps) {
  return (
    <div
      style={{
        width: 256,
        background: "#f0fdf4",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        borderRight: "1px solid #d1fae5",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid #d1fae5",
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 7,
          }}
        >
          <span style={{ color: "#15803d", fontWeight: 800, fontSize: 14 }}>
            💬 Chat
            {totalUnread > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: "#ef4444",
                  color: "#fff",
                  borderRadius: 10,
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 6px",
                }}
              >
                {totalUnread}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            title="Close chat"
            style={{
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              color: "#64748b",
              cursor: "pointer",
              width: 26,
              height: 26,
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background .15s, color .15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#ef4444";
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#f1f5f9";
              e.currentTarget.style.color = "#64748b";
              e.currentTarget.style.borderColor = "#e2e8f0";
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
          <button
            onClick={onNewDM}
            style={{
              flex: 1,
              padding: "5px 0",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            + Direct
          </button>
          <button
            onClick={onNewGroup}
            style={{
              flex: 1,
              padding: "5px 0",
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            + Group
          </button>
        </div>
        <input
          value={sideSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search chats…"
          style={{
            width: "100%",
            padding: "5px 9px",
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 5,
            color: "#1e293b",
            fontSize: 11,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Room list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {topLevel.length === 0 ? (
          <div
            style={{
              color: "#94a3b8",
              textAlign: "center",
              padding: "20px 12px",
              fontSize: 11,
            }}
          >
            {sideSearch
              ? "No chats found."
              : "No chats yet.\nStart with + Direct or + Group."}
          </div>
        ) : (
          topLevel.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              isActive={activeRoom?.id === room.id}
              activeRoomId={activeRoom?.id ?? null}
              onClick={onRoomClick}
              subMap={subMap}
              profileMap={profileMap}
              expandedGroups={expandedGroups}
              onToggleExpand={onToggleExpand}
              indent={false}
            />
          ))
        )}
      </div>
    </div>
  );
}
