import { fmtTime } from "@/utils/date";
import { avatarColor, initials } from "@/utils/avatar";
import type { ChatRoom, ID } from "@/types";

// Enriched ChatRoom used at runtime (displayName, unreadCount, lastMsg are populated by loadRooms)
type EnrichedRoom = ChatRoom & {
  displayName: string;
  unreadCount: number;
  lastMsg?: {
    message?: string;
    file_name?: string;
    created_at: string;
    sender_id: ID;
  } | null;
};

export interface RoomRowProps {
  room: EnrichedRoom;
  isActive: boolean;
  onClick: (room: EnrichedRoom) => void;
  subMap: Record<ID, EnrichedRoom[]>;
  profileMap: Record<ID, { full_name?: string }>;
  activeRoomId: ID | null;
  expandedGroups?: Set<ID>;
  onToggleExpand: (id: ID) => void;
  indent?: boolean;
}

export default function RoomRow({
  room,
  isActive,
  onClick,
  subMap,
  profileMap,
  activeRoomId,
  expandedGroups,
  onToggleExpand,
  indent = false,
}: RoomRowProps) {
  const subs = subMap[room.id] || [];
  const hasSubs = subs.length > 0;
  const isExpanded = expandedGroups?.has(room.id);
  const lastSender = room.lastMsg
    ? (profileMap[room.lastMsg.sender_id]?.full_name || "").split(" ")[0]
    : "";
  const preview = room.lastMsg
    ? room.lastMsg.message || `📎 ${room.lastMsg.file_name}`
    : "No messages yet";

  return (
    <>
      <div
        onClick={() => onClick(room)}
        style={{
          padding: indent ? "7px 14px 7px 28px" : "9px 14px",
          cursor: "pointer",
          borderBottom: "1px solid #e7f5ec",
          background: isActive ? "#dcfce7" : "transparent",
          transition: "background .1s",
          borderLeft: indent ? "3px solid #16a34a" : "none",
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.background = "#f0fdf4";
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLDivElement).style.background =
              "transparent";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Avatar */}
          <div
            style={{
              width: indent ? 26 : 36,
              height: indent ? 26 : 36,
              borderRadius: room.type === "group" ? 7 : "50%",
              background:
                room.type === "group"
                  ? "#7c3aed"
                  : avatarColor(room.displayName),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: indent ? 10 : 13,
              flexShrink: 0,
              boxShadow: "0 1px 3px rgba(0,0,0,.12)",
            }}
          >
            {room.type === "group"
              ? indent
                ? "⤷"
                : "👥"
              : initials(room.displayName)}
          </div>

          {/* Name + preview */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  color: isActive ? "#15803d" : "#1e293b",
                  fontWeight: room.unreadCount ? 800 : 600,
                  fontSize: indent ? 11 : 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {room.displayName}
              </span>
              <span style={{ color: "#94a3b8", fontSize: 9, flexShrink: 0 }}>
                {fmtTime(room.lastMsg?.created_at)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 120,
                }}
              >
                {lastSender ? `${lastSender}: ` : ""}
                {preview}
              </span>
              {room.unreadCount > 0 && (
                <span
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    borderRadius: 10,
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  {room.unreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Expand / collapse chevron — only for top-level groups with subgroups */}
          {hasSubs && !indent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(room.id);
              }}
              title={isExpanded ? "Hide subgroups" : "Show subgroups"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: 11,
                padding: "2px 4px",
                borderRadius: 4,
                flexShrink: 0,
                transition: "transform .2s",
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </button>
          )}
        </div>
      </div>

      {/* Subgroups — only shown when expanded */}
      {hasSubs && !indent && isExpanded && (
        <div style={{ background: "#f0fdf4" }}>
          {subs.map((sub) => (
            <RoomRow
              key={sub.id}
              room={sub}
              isActive={activeRoomId === sub.id}
              onClick={onClick}
              subMap={subMap}
              profileMap={profileMap}
              activeRoomId={activeRoomId}
              expandedGroups={expandedGroups}
              onToggleExpand={onToggleExpand}
              indent
            />
          ))}
        </div>
      )}
    </>
  );
}
