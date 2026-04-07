import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import type {
  ChatPageProps,
  ChatMessage,
  ChatRoom,
  ChatMemberRow,
  ChatRoomRow,
  AvatarDivProps,
  ModalWrapProps,
  MemberListProps,
  RoomRowProps,
} from "@/types/chat";
import type { Profile } from "@/types/auth";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AC = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#059669",
];
const avatarColor = (n?: string) => AC[(n?.charCodeAt(0) || 65) % AC.length];
const initials = (n?: string) =>
  (n || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
const fmtSize = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
const isImage = (t?: string) => t?.startsWith("image/") ?? false;

function fmtTime(d?: string): string {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  if (dt.toDateString() === now.toDateString())
    return dt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dt.toDateString() === y.toDateString()) return "Yesterday";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtFull(d?: string): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AvatarDiv({ name, size = 34, radius = "50%", icon }: AvatarDivProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: icon ? "#7c3aed" : avatarColor(name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {icon || initials(name)}
    </div>
  );
}

function ModalWrap({ onClose, children }: ModalWrapProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) =>
        e.target === e.currentTarget && onClose()
      }
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
          boxShadow: "0 12px 48px rgba(0,0,0,.25)",
        }}
        onMouseDown={(e: React.MouseEvent<HTMLDivElement>) =>
          e.stopPropagation()
        }
      >
        {children}
      </div>
    </div>
  );
}

function MemberList({ available, selected, onToggle }: MemberListProps) {
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
        available.map((p: Profile) => {
          const checked = selected.includes(p.id);
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
                  background: avatarColor(p.full_name || p.name),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {initials(p.full_name || p.name)}
              </div>
              <div>
                <div
                  style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}
                >
                  {p.full_name || p.name}
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

function RoomRow({
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
    ? (profileMap[room.lastMsg.sender]?.full_name || "").split(" ")[0]
    : "";
  const preview = room.lastMsg
    ? room.lastMsg.message || `📎 ${room.lastMsg.file_name}`
    : "No messages yet";

  return (
    <>
      <div
        onClick={() => onClick(room)}
        style={{
          padding: indent ? "7px 14px 7px 30px" : "9px 14px",
          cursor: "pointer",
          borderBottom: "1px solid #1a2537",
          background: isActive ? "#2d3f55" : "transparent",
          transition: "background .1s",
          borderLeft: indent ? "3px solid #4f46e5" : "none",
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = "#243347";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: indent ? 26 : 34,
              height: indent ? 26 : 34,
              borderRadius: room.type === "group" ? 6 : "50%",
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
            }}
          >
            {room.type === "group"
              ? indent
                ? "⤷"
                : "👥"
              : initials(room.displayName)}
          </div>
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
                  color: "#f1f5f9",
                  fontWeight: room.unreadCount ? 800 : 600,
                  fontSize: indent ? 11 : 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {room.displayName}
              </span>
              <span style={{ color: "#475569", fontSize: 9, flexShrink: 0 }}>
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
                  color: "#475569",
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
                    background: "#2563eb",
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
      {hasSubs && !indent && isExpanded && (
        <div style={{ background: "#172131" }}>
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

// ── Forward Modal ─────────────────────────────────────────────────────────────
function ForwardModal({
  forwardMsg,
  rooms,
  activeRoom,
  myId,
  profiles,
  onDone,
  onClose,
}: {
  forwardMsg: ChatMessage;
  rooms: ChatRoom[];
  activeRoom: ChatRoom | null;
  myId: string;
  profiles: Profile[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const allPeople = useMemo(
    () =>
      (profiles || [])
        .filter((p) => p.id !== myId)
        .map((p) => {
          const name = p.full_name || p.name || "Unknown";
          const existingRoom = rooms.find(
            (r) =>
              r.type === "direct" &&
              r.memberIds?.includes(myId) &&
              r.memberIds?.includes(p.id),
          );
          return {
            kind: "person" as const,
            id: p.id,
            name,
            role: p.role,
            existingRoomId: existingRoom?.id || null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [profiles, myId, rooms],
  );

  const groupRooms = useMemo(
    () =>
      rooms
        .filter((r) => r.type === "group" && r.id !== activeRoom?.id)
        .map((r) => ({
          kind: "room" as const,
          id: r.id,
          name: r.displayName,
          parentName: r.parent_room
            ? rooms.find((p) => p.id === String(r.parent_room))?.displayName ||
              ""
            : "",
          isSubgroup: !!r.parent_room,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rooms, activeRoom],
  );

  const q = search.toLowerCase();
  const filteredPeople = allPeople.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.role || "").toLowerCase().includes(q),
  );
  const filteredGroups = groupRooms.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.parentName.toLowerCase().includes(q),
  );

  const toggle = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  };
  const isChecked = (kind: string, id: string) =>
    selected.includes(`${kind}:${id}`);

  const handleSend = async () => {
    if (!selected.length) return;
    setSending(true);
    const fwdText = forwardMsg.message
      ? `↗ Forwarded:\n${forwardMsg.message}`
      : null;
    for (const key of selected) {
      const [kind, id] = key.split(":");
      let roomId: string | null = null;
      if (kind === "room") {
        roomId = id;
      } else {
        const person = allPeople.find((p) => p.id === id);
        roomId = person?.existingRoomId || null;
        if (!roomId) {
          const room = await apiPost<ChatRoomRow>("/chat_rooms/", {
            type: "direct",
            created_by: myId,
          });
          await Promise.all([
            apiPost("/chat_members/", { room: room.id, user: myId }),
            apiPost("/chat_members/", { room: room.id, user: id }),
          ]);
          roomId = room.id;
        }
      }
      if (roomId) {
        await apiPost("/chat_messages/", {
          room: roomId,
          message: fwdText || "↗ Forwarded",
        });
      }
    }
    setSending(false);
    onDone();
  };

  return (
    <ModalWrap onClose={onClose}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 15,
          marginBottom: 8,
          color: "#1e293b",
        }}
      >
        ↗ Forward Message
      </div>
      <div
        style={{
          padding: "7px 12px",
          background: "#f8fafc",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          marginBottom: 10,
          fontSize: 12,
          color: "#475569",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#94a3b8",
            marginBottom: 2,
          }}
        >
          Forwarding:
        </div>
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {forwardMsg.message ||
            (forwardMsg.file_name ? `📎 ${forwardMsg.file_name}` : "")}
        </div>
      </div>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Search people or groups…"
        style={{
          width: "100%",
          padding: "7px 10px",
          border: "1.5px solid #e2e8f0",
          borderRadius: 7,
          fontSize: 12,
          boxSizing: "border-box",
          outline: "none",
          marginBottom: 6,
          background: "#f8fafc",
          color: "#1e293b",
        }}
      />
      {selected.length > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "#2563eb",
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          ✓ {selected.length} selected
        </div>
      )}
      <div
        style={{
          overflowY: "auto",
          maxHeight: 300,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          flex: 1,
        }}
      >
        {filteredPeople.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                padding: "4px 2px 2px",
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              👤 People
            </div>
            {filteredPeople.map((p) => {
              const checked = isChecked("person", p.id);
              return (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: `1.5px solid ${checked ? "#2563eb" : "#e2e8f0"}`,
                    background: checked ? "#eff6ff" : "#f8fafc",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle("person", p.id)}
                    style={{
                      accentColor: "#2563eb",
                      width: 14,
                      height: 14,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: avatarColor(p.name),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    {initials(p.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#1e293b",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#94a3b8",
                        textTransform: "capitalize",
                      }}
                    >
                      {p.role || "Member"}
                    </div>
                  </div>
                  {checked && (
                    <span
                      style={{
                        color: "#2563eb",
                        fontWeight: 800,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </label>
              );
            })}
          </>
        )}
        {filteredGroups.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                padding: "8px 2px 2px",
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              👥 Groups
            </div>
            {filteredGroups.map((r) => {
              const checked = isChecked("room", r.id);
              return (
                <label
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: `1.5px solid ${checked ? "#7c3aed" : "#e2e8f0"}`,
                    background: checked ? "#f5f3ff" : "#f8fafc",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle("room", r.id)}
                    style={{
                      accentColor: "#7c3aed",
                      width: 14,
                      height: 14,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      background: r.isSubgroup ? "#4f46e5" : "#7c3aed",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {r.isSubgroup ? "⤷" : "👥"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#1e293b",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.name}
                      {r.parentName && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 400,
                            color: "#7c3aed",
                            marginLeft: 5,
                          }}
                        >
                          ({r.parentName})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {r.isSubgroup ? "Subgroup" : "Group"}
                    </div>
                  </div>
                  {checked && (
                    <span
                      style={{
                        color: "#7c3aed",
                        fontWeight: 800,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </label>
              );
            })}
          </>
        )}
        {filteredPeople.length === 0 && filteredGroups.length === 0 && (
          <div
            style={{
              color: "#94a3b8",
              fontSize: 12,
              textAlign: "center",
              padding: 20,
            }}
          >
            No results for "{search}"
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
          onClick={handleSend}
          disabled={!selected.length || sending}
          style={{
            flex: 2,
            padding: "8px 0",
            background: selected.length ? "#2563eb" : "#cbd5e1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: selected.length ? "pointer" : "default",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {sending
            ? "Sending…"
            : `↗ Forward${selected.length ? ` to ${selected.length}` : ""}`}
        </button>
      </div>
    </ModalWrap>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function FloatingChat({ profile, profiles }: ChatPageProps) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteFile, setPasteFile] = useState<File | null>(null);
  const [pastePreviewUrl, setPastePreviewUrl] = useState("");
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sideSearch, setSideSearch] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: ChatMessage;
  } | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);

  const [showDM, setShowDM] = useState(false);
  const [showGrp, setShowGrp] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showAddMbr, setShowAddMbr] = useState(false);

  const [grpName, setGrpName] = useState("");
  const [grpMembers, setGrpMembers] = useState<string[]>([]);
  const [subName, setSubName] = useState("");
  const [subMembers, setSubMembers] = useState<string[]>([]);
  const [addMembers, setAddMembers] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRoomRef = useRef<ChatRoom | null>(null);
  const globalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const myId = profile?.id;

  // ── Notification sound (Web Audio API) ────────────────────────────────────
  const playNotifSound = useCallback(() => {
    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
      osc.onended = () => ctx.close();
    } catch {
      /* audio not supported */
    }
  }, []);
  const profileMap = useMemo(
    () => Object.fromEntries((profiles || []).map((p) => [p.id, p])),
    [profiles],
  );
  const otherUsers = useMemo(
    () =>
      (profiles || [])
        .filter((p) => p.id !== myId)
        .sort((a, b) =>
          (a.full_name || a.name || "").localeCompare(
            b.full_name || b.name || "",
          ),
        ),
    [profiles, myId],
  );

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  // ── Load rooms ─────────────────────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!myId) return;
    const roomRows = await apiGet<ChatRoomRow[]>("/chat_rooms/");
    const enriched = await Promise.all(
      roomRows.map(async (room) => {
        const [memberRows, allMsgs] = await Promise.all([
          apiGet<ChatMemberRow[]>(`/chat_members/?room_id=${room.id}`),
          apiGet<ChatMessage[]>(`/chat_messages/?room_id=${room.id}`),
        ]);
        const myMember = memberRows.find((m) => m.user === String(myId));
        const lastReadAt = myMember?.last_read_at || "1970-01-01";
        const lastMsg = allMsgs.length ? allMsgs[allMsgs.length - 1] : null;
        const unreadCount = allMsgs.filter(
          (m) => m.sender !== String(myId) && m.created_at > lastReadAt,
        ).length;
        const memberIds = memberRows.map((m) => m.user);
        let displayName = room.name || "";
        if (room.type === "direct") {
          const oid = memberIds.find((id) => id !== String(myId));
          const op = oid ? profileMap[oid] : null;
          displayName = op?.full_name || op?.name || "Unknown";
        }
        return {
          ...room,
          displayName: displayName || "Unknown",
          lastMsg,
          memberIds,
          unreadCount,
        } as ChatRoom;
      }),
    );
    enriched.sort((a, b) => {
      const aT = a.lastMsg?.created_at || a.created_at;
      const bT = b.lastMsg?.created_at || b.created_at;
      return aT > bT ? -1 : 1;
    });
    setRooms(enriched);
  }, [myId, profileMap]);

  // ── Global notification poll (runs even when panel is closed) ─────────────
  useEffect(() => {
    if (!myId) return;
    let lastCheck = new Date().toISOString();
    globalPollRef.current = setInterval(async () => {
      try {
        const msgs = await apiGet<ChatMessage[]>(
          `/chat_messages/?since=${lastCheck}`,
        );
        const newOnes = (msgs || []).filter((m) => m.sender !== String(myId));
        if (newOnes.length > 0) {
          playNotifSound();
          lastCheck = new Date().toISOString();
          // Refresh rooms to update unread counts
          if (!open) loadRooms();
        }
      } catch {
        /* ignore */
      }
    }, 15000);
    return () => {
      if (globalPollRef.current) clearInterval(globalPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, playNotifSound]);

  const handleToggleOpen = useCallback(() => {
    setOpen((prev) => {
      if (!prev) void loadRooms();
      return !prev;
    });
  }, [loadRooms]);

  // ── Load messages ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(
    async (roomId: string, silent = false) => {
      if (!silent) setLoadingMsgs(true);
      const data = await apiGet<ChatMessage[]>(
        `/chat_messages/?room_id=${roomId}`,
      );
      setMessages(data);
      if (!silent) setLoadingMsgs(false);
      const members = await apiGet<ChatMemberRow[]>(
        `/chat_members/?room_id=${roomId}`,
      );
      const myMember = members.find((m) => m.user === String(myId));
      if (myMember) {
        await apiPatch(`/chat_members/${myMember.id}/`, {
          last_read_at: new Date().toISOString(),
        });
      }
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    },
    [myId],
  );

  useEffect(() => {
    if (!activeRoom) return;
    const roomId = activeRoom.id;
    (async () => {
      setLoadingMsgs(true);
      const data = await apiGet<ChatMessage[]>(
        `/chat_messages/?room_id=${roomId}`,
      );
      setMessages(data);
      setLoadingMsgs(false);
      const members = await apiGet<ChatMemberRow[]>(
        `/chat_members/?room_id=${roomId}`,
      );
      const myMember = members.find((m) => m.user === String(myId));
      if (myMember)
        await apiPatch(`/chat_members/${myMember.id}/`, {
          last_read_at: new Date().toISOString(),
        });
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    })();
  }, [activeRoom?.id, myId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeRoom || !open) return;
    pollRef.current = setInterval(async () => {
      const room = activeRoomRef.current;
      if (room) await loadMessages(room.id, true);
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRoom?.id, open, loadMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send text ──────────────────────────────────────────────────────────────
  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = newMsg.trim();
    if (!text && !pasteFile) return;
    if (!activeRoom || sending) return;
    setSending(true);
    setNewMsg("");
    const replyId = replyTo?.id || null;
    setReplyTo(null);
    // Upload pasted image first if present
    if (pasteFile) {
      const file = pasteFile;
      clearPaste();
      setUploading(true);
      const formData = new FormData();
      formData.append("room", String(activeRoom.id));
      formData.append("file_name", file.name);
      formData.append("file_type", file.type);
      formData.append("file_size", String(file.size));
      if (replyId) formData.append("reply_to_id", replyId);
      formData.append("file", file);
      try {
        const token = localStorage.getItem("tt_access");
        const res = await fetch("/api/chat_messages/", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!res.ok) alert("Image upload failed");
      } catch {
        alert("Image upload failed");
      }
      setUploading(false);
    }
    if (text) {
      await apiPost("/chat_messages/", {
        room: activeRoom.id,
        message: text,
        ...(replyId ? { reply_to_id: replyId } : {}),
      });
    }
    setSending(false);
    await loadMessages(activeRoom.id, true);
    loadRooms();
    inputRef.current?.focus();
  };

  // ── Send file ──────────────────────────────────────────────────────────────
  const sendFile = async (file: File) => {
    if (!file || !activeRoom) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("room", String(activeRoom.id));
    formData.append("file_name", file.name);
    formData.append("file_type", file.type);
    formData.append("file_size", String(file.size));
    formData.append("file", file);
    try {
      const token = localStorage.getItem("tt_access");
      const res = await fetch("/api/chat_messages/", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) alert("Upload failed");
    } catch {
      alert("Upload failed");
    }
    setUploading(false);
    await loadMessages(activeRoom.id, true);
    loadRooms();
  };

  const downloadFile = (msg: ChatMessage) => {
    if (msg.file_path)
      window.open(`/api/chat_messages/${msg.id}/download/`, "_blank");
  };

  // ── Paste handler — captures image from clipboard (Ctrl+V) ────────────────
  const clearPaste = () => {
    if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
    setPasteFile(null);
    setPastePreviewUrl("");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find((it) => it.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const raw = imgItem.getAsFile();
    if (!raw) return;
    const ext = raw.type.split("/")[1] || "png";
    const named = new File([raw], `pasted-${Date.now()}.${ext}`, {
      type: raw.type,
    });
    if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
    setPasteFile(named);
    setPastePreviewUrl(URL.createObjectURL(named));
  };

  // ── Create DM ──────────────────────────────────────────────────────────────
  const createDM = async (otherId: string) => {
    const ex = rooms.find(
      (r) =>
        r.type === "direct" &&
        r.memberIds.includes(String(myId!)) &&
        r.memberIds.includes(otherId),
    );
    if (ex) {
      setActiveRoom(ex);
      setShowDM(false);
      return;
    }
    const room = await apiPost<ChatRoomRow>("/chat_rooms/", {
      type: "direct",
      created_by: myId,
    });
    await Promise.all([
      apiPost("/chat_members/", { room: room.id, user: myId }),
      apiPost("/chat_members/", { room: room.id, user: otherId }),
    ]);
    const op = profileMap[otherId];
    const nr: ChatRoom = {
      ...room,
      displayName: op?.full_name || op?.name || "Unknown",
      memberIds: [String(myId!), otherId],
      lastMsg: null,
      unreadCount: 0,
    };
    setRooms((prev) => [nr, ...prev]);
    setActiveRoom(nr);
    setShowDM(false);
  };

  // ── Create Group ───────────────────────────────────────────────────────────
  const createGroup = async () => {
    if (!grpName.trim()) return alert("Enter a group name");
    if (!grpMembers.length) return alert("Select at least one member");
    const room = await apiPost<ChatRoomRow>("/chat_rooms/", {
      name: grpName.trim(),
      type: "group",
      created_by: myId,
    });
    const all = [...new Set([String(myId!), ...grpMembers])];
    await Promise.all(
      all.map((uid) => apiPost("/chat_members/", { room: room.id, user: uid })),
    );
    const nr: ChatRoom = {
      ...room,
      displayName: grpName.trim(),
      memberIds: all,
      lastMsg: null,
      unreadCount: 0,
    };
    setRooms((prev) => [nr, ...prev]);
    setActiveRoom(nr);
    setShowGrp(false);
    setGrpName("");
    setGrpMembers([]);
  };

  // ── Add members to existing group ──────────────────────────────────────────
  const addMembersToGroup = async () => {
    if (!addMembers.length) return alert("Select at least one member to add");
    if (!activeRoom) return;
    await Promise.all(
      addMembers.map((uid) =>
        apiPost("/chat_members/", { room: activeRoom.id, user: uid }),
      ),
    );
    const updatedIds = [...new Set([...activeRoom.memberIds, ...addMembers])];
    const updatedRoom = { ...activeRoom, memberIds: updatedIds };
    setActiveRoom(updatedRoom);
    setRooms((prev) =>
      prev.map((r) => (r.id === activeRoom.id ? updatedRoom : r)),
    );
    setShowAddMbr(false);
    setAddMembers([]);
    loadRooms();
  };

  // ── Create Subgroup ────────────────────────────────────────────────────────
  const createSubGroup = async () => {
    if (!subName.trim()) return alert("Enter a subgroup name");
    if (!subMembers.length) return alert("Select at least one member");
    if (!activeRoom) return;
    const room = await apiPost<ChatRoomRow>("/chat_rooms/", {
      name: subName.trim(),
      type: "group",
      created_by: myId,
      parent_room: activeRoom.id,
    });
    const all = [...new Set([String(myId!), ...subMembers])];
    await Promise.all(
      all.map((uid) => apiPost("/chat_members/", { room: room.id, user: uid })),
    );
    const nr: ChatRoom = {
      ...room,
      displayName: subName.trim(),
      memberIds: all,
      lastMsg: null,
      unreadCount: 0,
      parent_room: activeRoom.id,
    };
    setRooms((prev) => [...prev, nr]);
    setActiveRoom(nr);
    setShowSub(false);
    setSubName("");
    setSubMembers([]);
    loadRooms();
  };

  // ── Sidebar filtering & hierarchy ──────────────────────────────────────────
  const filteredRooms = useMemo(() => {
    const q = sideSearch.toLowerCase().trim();
    return q
      ? rooms.filter((r) => r.displayName?.toLowerCase().includes(q))
      : rooms;
  }, [rooms, sideSearch]);

  const topLevel = useMemo(
    () => filteredRooms.filter((r) => !r.parent_room),
    [filteredRooms],
  );
  const subMap = useMemo(() => {
    const m: Record<string, ChatRoom[]> = {};
    filteredRooms
      .filter((r) => !!r.parent_room)
      .forEach((r) => {
        const parent = String(r.parent_room!);
        if (!m[parent]) m[parent] = [];
        m[parent].push(r);
      });
    return m;
  }, [filteredRooms]);

  const totalUnread = useMemo(
    () => rooms.reduce((s, r) => s + (r.unreadCount || 0), 0),
    [rooms],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleToggleExpand = useCallback((roomId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }, []);

  const handleRoomClick = useCallback(
    async (room: ChatRoom) => {
      setActiveRoom(room);
      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r)),
      );
      if (room.type === "group" && !room.parent_room) {
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          next.add(room.id);
          return next;
        });
      }
      await loadMessages(room.id);
    },
    [loadMessages],
  );

  const toggleMember = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
      setter((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      ),
    [],
  );

  const nonMembers = useMemo(
    () =>
      otherUsers
        .filter((p) => !(activeRoom?.memberIds || []).includes(p.id))
        .sort((a, b) =>
          (a.full_name || a.name || "").localeCompare(
            b.full_name || b.name || "",
          ),
        ),
    [otherUsers, activeRoom],
  );

  const parentMembers = useMemo(
    () =>
      otherUsers
        .filter((p) => (activeRoom?.memberIds || []).includes(p.id))
        .sort((a, b) =>
          (a.full_name || a.name || "").localeCompare(
            b.full_name || b.name || "",
          ),
        ),
    [otherUsers, activeRoom],
  );

  const PW = Math.min(
    840,
    (typeof window !== "undefined" ? window.innerWidth : 900) - 40,
  );
  const PH = Math.min(
    590,
    (typeof window !== "undefined" ? window.innerHeight : 700) - 220,
  );

  return (
    <>
      {/* ── Floating button ───────────────────────────────────────────────── */}
      <button
        onClick={handleToggleOpen}
        title="Team Chat"
        style={{
          position: "fixed",
          bottom: 86,
          right: 24,
          zIndex: 9000,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: open ? "#1e293b" : "#2563eb",
          color: "#fff",
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s,transform .15s",
          transform: open ? "rotate(45deg) scale(1.05)" : "scale(1)",
        }}
      >
        {open ? "✕" : "💬"}
        {!open && totalUnread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#ef4444",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              borderRadius: "50%",
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
            }}
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {/* ── Chat panel ────────────────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 150,
            right: 24,
            zIndex: 8999,
            width: PW,
            height: PH,
            borderRadius: 14,
            boxShadow: "0 12px 48px rgba(0,0,0,.3)",
            display: "flex",
            overflow: "hidden",
            border: "1px solid #1e293b",
          }}
        >
          {/* Sidebar */}
          <div
            style={{
              width: 256,
              background: "#1e293b",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                padding: "10px 12px 8px",
                borderBottom: "1px solid #334155",
                flexShrink: 0,
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
                <span
                  style={{ color: "#f8fafc", fontWeight: 800, fontSize: 14 }}
                >
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
              </div>
              <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
                <button
                  onClick={() => setShowDM(true)}
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
                  onClick={() => setShowGrp(true)}
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
                onChange={(e) => setSideSearch(e.target.value)}
                placeholder="Search chats…"
                style={{
                  width: "100%",
                  padding: "5px 9px",
                  background: "#334155",
                  border: "none",
                  borderRadius: 5,
                  color: "#f1f5f9",
                  fontSize: 11,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {topLevel.length === 0 ? (
                <div
                  style={{
                    color: "#64748b",
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
                    activeRoomId={activeRoom?.id}
                    onClick={handleRoomClick}
                    subMap={subMap}
                    profileMap={profileMap}
                    expandedGroups={expandedGroups}
                    onToggleExpand={handleToggleExpand}
                    indent={false}
                  />
                ))
              )}
            </div>
          </div>

          {/* Message area */}
          {activeRoom ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "#f8fafc",
                minWidth: 0,
              }}
            >
              {/* Room header */}
              <div
                style={{
                  padding: "8px 14px",
                  background: "#fff",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: activeRoom.type === "group" ? 7 : "50%",
                    background:
                      activeRoom.type === "group"
                        ? "#7c3aed"
                        : avatarColor(activeRoom.displayName),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {activeRoom.type === "group"
                    ? activeRoom.parent_room
                      ? "⤷"
                      : "👥"
                    : initials(activeRoom.displayName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: "#1e293b",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeRoom.displayName}
                    {activeRoom.parent_room && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#94a3b8",
                          fontWeight: 400,
                          marginLeft: 6,
                        }}
                      >
                        subgroup of{" "}
                        {rooms.find(
                          (r) => r.id === String(activeRoom.parent_room),
                        )?.displayName || "group"}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#94a3b8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeRoom.type === "group"
                      ? `${activeRoom.memberIds?.length || 0} members · ${(
                          activeRoom.memberIds || []
                        )
                          .map(
                            (id) =>
                              (
                                profileMap[id]?.full_name ||
                                profileMap[id]?.name ||
                                ""
                              ).split(" ")[0],
                          )
                          .filter(Boolean)
                          .join(", ")}`
                      : "🔒 Private direct message"}
                  </div>
                </div>
                {activeRoom.type === "group" && (
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setAddMembers([]);
                        setShowAddMbr(true);
                      }}
                      title="Add more members"
                      style={{
                        padding: "4px 9px",
                        background: "#16a34a",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      + Members
                    </button>
                    {!activeRoom.parent_room && (
                      <button
                        onClick={() => {
                          setSubName("");
                          setSubMembers([]);
                          setShowSub(true);
                        }}
                        title="Create a subgroup"
                        style={{
                          padding: "4px 9px",
                          background: "#7c3aed",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        + Subgroup
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Messages */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                {loadingMsgs ? (
                  <div
                    style={{
                      color: "#94a3b8",
                      textAlign: "center",
                      padding: 30,
                    }}
                  >
                    Loading…
                  </div>
                ) : messages.length === 0 ? (
                  <div
                    style={{
                      color: "#94a3b8",
                      textAlign: "center",
                      padding: 30,
                      fontSize: 13,
                    }}
                  >
                    No messages yet — say hello! 👋
                  </div>
                ) : (
                  (() => {
                    let lastDate = "";
                    return messages.map((msg, idx) => {
                      const isMe = msg.sender === String(myId);
                      const sender = profileMap[msg.sender];
                      const senderName =
                        sender?.full_name || sender?.name || "Unknown";
                      const prev = messages[idx - 1];
                      const sameAuthor = prev?.sender === msg.sender;
                      const msgDate = new Date(msg.created_at).toDateString();
                      const showDate = msgDate !== lastDate;
                      if (showDate) lastDate = msgDate;
                      return (
                        <React.Fragment key={msg.id}>
                          {showDate && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                margin: "8px 0 4px",
                              }}
                            >
                              <div
                                style={{
                                  flex: 1,
                                  height: 1,
                                  background: "#e2e8f0",
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "#94a3b8",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {new Date(msg.created_at).toLocaleDateString(
                                  "en-GB",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )}
                              </span>
                              <div
                                style={{
                                  flex: 1,
                                  height: 1,
                                  background: "#e2e8f0",
                                }}
                              />
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: isMe ? "row-reverse" : "row",
                              alignItems: "flex-end",
                              gap: 6,
                              marginTop: sameAuthor && !showDate ? 2 : 6,
                            }}
                          >
                            {!isMe && (
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "50%",
                                  background: avatarColor(senderName),
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fff",
                                  fontWeight: 700,
                                  fontSize: 10,
                                  visibility:
                                    !sameAuthor || showDate
                                      ? "visible"
                                      : "hidden",
                                }}
                              >
                                {initials(senderName)}
                              </div>
                            )}
                            <div
                              style={{
                                maxWidth: "66%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: isMe ? "flex-end" : "flex-start",
                              }}
                            >
                              {(!sameAuthor || showDate) && !isMe && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    color: "#64748b",
                                    marginBottom: 2,
                                    marginLeft: 2,
                                  }}
                                >
                                  {senderName}
                                </span>
                              )}
                              <div
                                style={{
                                  background: isMe ? "#2563eb" : "#fff",
                                  color: isMe ? "#fff" : "#1e293b",
                                  borderRadius: isMe
                                    ? "12px 12px 2px 12px"
                                    : "12px 12px 12px 2px",
                                  padding: "7px 11px",
                                  boxShadow: "0 1px 3px rgba(0,0,0,.09)",
                                  fontSize: 12.5,
                                  lineHeight: 1.5,
                                  wordBreak: "break-word",
                                  cursor: "context-menu",
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    msg,
                                  });
                                }}
                              >
                                {msg.message && (
                                  <div style={{ whiteSpace: "pre-wrap" }}>
                                    {msg.message}
                                  </div>
                                )}
                                {msg.file_path && (
                                  <div
                                    onClick={() => downloadFile(msg)}
                                    style={{
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      padding: "5px 8px",
                                      borderRadius: 7,
                                      marginTop: msg.message ? 6 : 0,
                                      background: isMe
                                        ? "rgba(255,255,255,.15)"
                                        : "#f1f5f9",
                                      border: `1px solid ${isMe ? "rgba(255,255,255,.2)" : "#e2e8f0"}`,
                                    }}
                                  >
                                    <span
                                      style={{ fontSize: 20, flexShrink: 0 }}
                                    >
                                      {isImage(msg.file_type) ? "🖼" : "📄"}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 600,
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          maxWidth: 160,
                                        }}
                                      >
                                        {msg.file_name}
                                      </div>
                                      {msg.file_size && (
                                        <div
                                          style={{
                                            fontSize: 10,
                                            color: isMe ? "#bfdbfe" : "#94a3b8",
                                          }}
                                        >
                                          {fmtSize(msg.file_size)}
                                        </div>
                                      )}
                                    </div>
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: isMe ? "#bfdbfe" : "#2563eb",
                                        fontWeight: 700,
                                        flexShrink: 0,
                                      }}
                                    >
                                      ⬇ Open
                                    </span>
                                  </div>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: 9,
                                  color: "#94a3b8",
                                  marginTop: 2,
                                  marginLeft: isMe ? 0 : 2,
                                  marginRight: isMe ? 2 : 0,
                                }}
                              >
                                {fmtFull(msg.created_at)}
                              </span>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    });
                  })()
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input bar */}
              <div
                style={{
                  padding: "9px 14px",
                  background: "#fff",
                  borderTop: "1px solid #e2e8f0",
                  flexShrink: 0,
                }}
              >
                {/* Reply-to strip */}
                {replyTo && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 7,
                      padding: "6px 10px",
                      background: "#f0fdf4",
                      border: "1.5px solid #86efac",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        borderLeft: "3px solid #16a34a",
                        paddingLeft: 7,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#16a34a",
                          marginBottom: 1,
                        }}
                      >
                        ↩ Replying to{" "}
                        {profileMap[replyTo.sender]?.full_name ||
                          profileMap[replyTo.sender]?.name ||
                          "Unknown"}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#475569",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {replyTo.message ||
                          (replyTo.file_name ? `📎 ${replyTo.file_name}` : "")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#94a3b8",
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 2,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Paste image preview strip */}
                {pasteFile && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                      padding: "7px 10px",
                      background: "#eff6ff",
                      border: "1.5px solid #bfdbfe",
                      borderRadius: 8,
                    }}
                  >
                    <img
                      src={pastePreviewUrl}
                      alt="paste"
                      style={{
                        width: 46,
                        height: 46,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid #bfdbfe",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#1e40af",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        🖼 {pasteFile.name}
                      </div>
                      <div
                        style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}
                      >
                        {fmtSize(pasteFile.size)} · Pasted image — click ➤ to
                        send
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearPaste}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#94a3b8",
                        fontSize: 18,
                        lineHeight: 1,
                        padding: 2,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                <form
                  onSubmit={sendMessage}
                  style={{ display: "flex", gap: 7, alignItems: "center" }}
                >
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Attach file"
                    style={{
                      padding: "7px 9px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 7,
                      background: "#f8fafc",
                      cursor: "pointer",
                      fontSize: 15,
                      color: "#64748b",
                      flexShrink: 0,
                      opacity: uploading ? 0.6 : 1,
                    }}
                  >
                    {uploading ? "⏳" : "📎"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        sendFile(file);
                        e.target.value = "";
                      }
                    }}
                  />
                  <input
                    ref={inputRef}
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    onPaste={handlePaste}
                    placeholder={
                      pasteFile
                        ? "Add a caption (optional)…"
                        : `Message ${activeRoom.displayName}…`
                    }
                    style={{
                      flex: 1,
                      padding: "7px 12px",
                      border: `1.5px solid ${pasteFile ? "#bfdbfe" : "#e2e8f0"}`,
                      borderRadius: 7,
                      fontSize: 12,
                      outline: "none",
                      background: pasteFile ? "#f0f7ff" : "#f8fafc",
                      color: "#1e293b",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={
                      (!newMsg.trim() && !pasteFile) || sending || uploading
                    }
                    style={{
                      padding: "7px 14px",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                      opacity:
                        (!newMsg.trim() && !pasteFile) || sending || uploading
                          ? 0.5
                          : 1,
                    }}
                  >
                    ➤
                  </button>
                </form>
                <div
                  style={{
                    fontSize: 9,
                    color: "#94a3b8",
                    marginTop: 3,
                    textAlign: "center",
                  }}
                >
                  Enter to send · Shift+Enter for new line · 📎 attach · Ctrl+V
                  paste image · Right-click to Reply/Forward
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 10,
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: 40 }}>💬</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                Select a chat
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  textAlign: "center",
                  maxWidth: 240,
                }}
              >
                Or start a new conversation using the buttons on the left.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── New DM Modal ──────────────────────────────────────────────────── */}
      {showDM && (
        <ModalWrap onClose={() => setShowDM(false)}>
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
                onClick={() => createDM(p.id)}
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
                  e.currentTarget.style.background = "#eff6ff";
                  e.currentTarget.style.borderColor = "#93c5fd";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f8fafc";
                  e.currentTarget.style.borderColor = "#e2e8f0";
                }}
              >
                <AvatarDiv name={p.full_name || p.name} />
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
            onClick={() => setShowDM(false)}
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
      )}

      {/* ── New Group Modal ───────────────────────────────────────────────── */}
      {showGrp && (
        <ModalWrap
          onClose={() => {
            setShowGrp(false);
            setGrpName("");
            setGrpMembers([]);
          }}
        >
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
              onClick={() => {
                setShowGrp(false);
                setGrpName("");
                setGrpMembers([]);
              }}
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
              onClick={createGroup}
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
      )}

      {/* ── Add Members Modal ─────────────────────────────────────────────── */}
      {showAddMbr && (
        <ModalWrap
          onClose={() => {
            setShowAddMbr(false);
            setAddMembers([]);
          }}
        >
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
              onClick={() => {
                setShowAddMbr(false);
                setAddMembers([]);
              }}
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
              onClick={addMembersToGroup}
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
      )}

      {/* ── New Subgroup Modal ────────────────────────────────────────────── */}
      {showSub && (
        <ModalWrap
          onClose={() => {
            setShowSub(false);
            setSubName("");
            setSubMembers([]);
          }}
        >
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
            Under: <b style={{ color: "#7c3aed" }}>{activeRoom?.displayName}</b>{" "}
            · Only this group's members can be added.
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
              onClick={() => {
                setShowSub(false);
                setSubName("");
                setSubMembers([]);
              }}
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
              onClick={createSubGroup}
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
      )}

      {/* ── Right-click Context Menu ──────────────────────────────────────── */}
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 19998 }}
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            style={{
              position: "fixed",
              top: Math.min(contextMenu.y, window.innerHeight - 110),
              left: Math.min(contextMenu.x, window.innerWidth - 160),
              zIndex: 19999,
              background: "#fff",
              borderRadius: 10,
              boxShadow: "0 8px 32px rgba(0,0,0,.18)",
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              minWidth: 150,
            }}
          >
            <div
              style={{
                padding: "8px 14px 6px",
                borderBottom: "1px solid #f1f5f9",
                fontSize: 10,
                color: "#94a3b8",
                maxWidth: 150,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {contextMenu.msg.message ||
                (contextMenu.msg.file_name
                  ? `📎 ${contextMenu.msg.file_name}`
                  : "")}
            </div>
            <div
              onClick={() => {
                setReplyTo(contextMenu.msg);
                setContextMenu(null);
                inputRef.current?.focus();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#1e293b",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#eff6ff")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span style={{ fontSize: 16 }}>↩</span> Reply
            </div>
            <div
              onClick={() => {
                setForwardMsg(contextMenu.msg);
                setContextMenu(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#1e293b",
                borderTop: "1px solid #f1f5f9",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f0fdf4")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span style={{ fontSize: 16 }}>↗</span> Forward
            </div>
          </div>
        </>
      )}

      {/* ── Forward Message Modal ─────────────────────────────────────────── */}
      {forwardMsg && (
        <ForwardModal
          forwardMsg={forwardMsg}
          rooms={rooms}
          activeRoom={activeRoom}
          myId={String(myId!)}
          profiles={profiles || []}
          onDone={() => {
            setForwardMsg(null);
            loadRooms();
          }}
          onClose={() => setForwardMsg(null)}
        />
      )}
    </>
  );
}
