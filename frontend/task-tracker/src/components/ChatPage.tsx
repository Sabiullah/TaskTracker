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
} from "@/types/chat";
import type { Profile } from "@/types/auth";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#059669",
];
const avatarColor = (name: string) =>
  AVATAR_COLORS[(name?.charCodeAt(0) || 65) % AVATAR_COLORS.length];
const initials = (name: string) =>
  (name || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
const fmtSize = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
const isImage = (t: string) => t?.startsWith("image/");

function fmtTime(d: string | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  const isToday = dt.toDateString() === now.toDateString();
  if (isToday)
    return dt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (dt.toDateString() === yest.toDateString()) return "Yesterday";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtFull(d: string | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChatPage({ profile, profiles }: ChatPageProps) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGrp, setShowNewGrp] = useState(false);
  const [grpName, setGrpName] = useState("");
  const [grpMembers, setGrpMembers] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRoomRef = useRef<ChatRoom | null>(null);

  const myId = profile?.id;
  const profileMap = useMemo(
    () => Object.fromEntries((profiles || []).map((p: Profile) => [p.id, p])),
    [profiles],
  );
  const otherUsers = useMemo(
    () => (profiles || []).filter((p: Profile) => p.id !== myId),
    [profiles, myId],
  );
  const filteredRooms = useMemo(() => {
    if (!search.trim()) return rooms;
    return rooms.filter((r: ChatRoom) =>
      r.displayName?.toLowerCase().includes(search.toLowerCase()),
    );
  }, [rooms, search]);

  // Keep ref in sync for use inside polling interval
  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  // ── Build enriched room from raw data ────────────────────────────────────────
  const buildRoom = useCallback(
    (
      roomRow: ChatRoomRow,
      memberRows: ChatMemberRow[],
      lastMsg: ChatMessage | null,
      unreadCount: number,
    ): ChatRoom => {
      const memberIds = memberRows.map((m) => m.user);
      let displayName = roomRow.name || "";
      if (roomRow.type === "direct") {
        const otherId = memberIds.find((id) => id !== String(myId));
        const other = otherId ? profileMap[otherId] : null;
        displayName = other?.full_name || other?.name || "Unknown";
      }
      return {
        ...roomRow,
        displayName: displayName || "Unknown",
        lastMsg,
        memberIds,
        unreadCount,
      };
    },
    [myId, profileMap],
  );

  // ── Load rooms ───────────────────────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!myId) return;
    try {
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
          return buildRoom(room, memberRows, lastMsg, unreadCount);
        }),
      );
      enriched.sort((a, b) => {
        const aT = a.lastMsg?.created_at || a.created_at;
        const bT = b.lastMsg?.created_at || b.created_at;
        return aT > bT ? -1 : 1;
      });
      setRooms(enriched);
    } finally {
      setLoadingRooms(false);
    }
  }, [myId, buildRoom]);

  // ── Load messages ────────────────────────────────────────────────────────────
  const loadMessages = useCallback(
    async (roomId: string, silent = false) => {
      if (!silent) setLoadingMsgs(true);
      const data = await apiGet<ChatMessage[]>(
        `/chat_messages/?room_id=${roomId}`,
      );
      setMessages(data);
      if (!silent) setLoadingMsgs(false);
      // Mark as read
      const members = await apiGet<ChatMemberRow[]>(
        `/chat_members/?room_id=${roomId}`,
      );
      const myMember = members.find((m) => m.user === String(myId));
      if (myMember) {
        await apiPatch(`/chat_members/${myMember.id}/`, {
          last_read_at: new Date().toISOString(),
        });
      }
      // Scroll to bottom
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    },
    [myId],
  );

  // Load rooms on mount
  useEffect(() => {
    if (myId) loadRooms();
  }, [myId, loadRooms]);

  // Load messages when active room changes
  useEffect(() => {
    if (activeRoom && myId) loadMessages(activeRoom.id);
  }, [activeRoom?.id, myId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling for new messages
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeRoom) return;
    pollRef.current = setInterval(async () => {
      const room = activeRoomRef.current;
      if (room) await loadMessages(room.id, true);
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRoom?.id, loadMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send text ────────────────────────────────────────────────────────────────
  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = newMsg.trim();
    if (!text || !activeRoom || sending) return;
    setSending(true);
    setNewMsg("");
    await apiPost("/chat_messages/", { room: activeRoom.id, message: text });
    setSending(false);
    await loadMessages(activeRoom.id, true);
    loadRooms();
    inputRef.current?.focus();
  };

  // ── Send file ────────────────────────────────────────────────────────────────
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
      // Use fetch directly so browser sets multipart Content-Type with boundary
      const token = localStorage.getItem("tt_access");
      const res = await fetch("/api/chat_messages/", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        alert("Upload failed");
      }
    } catch {
      alert("Upload failed");
    }
    setUploading(false);
    await loadMessages(activeRoom.id, true);
    loadRooms();
  };

  // ── Download file ────────────────────────────────────────────────────────────
  const downloadFile = (msg: ChatMessage) => {
    if (msg.file_path)
      window.open(`/api/chat_messages/${msg.id}/download/`, "_blank");
  };

  // ── Create DM ────────────────────────────────────────────────────────────────
  const createDM = async (otherId: string) => {
    const existing = rooms.find(
      (r) =>
        r.type === "direct" &&
        r.memberIds.includes(String(myId!)) &&
        r.memberIds.includes(otherId),
    );
    if (existing) {
      setActiveRoom(existing);
      setShowNewDM(false);
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
    const other = profileMap[otherId];
    const newRoom: ChatRoom = {
      ...room,
      displayName: other?.full_name || other?.name || "Unknown",
      memberIds: [String(myId!), otherId],
      lastMsg: null,
      unreadCount: 0,
    };
    setRooms((prev) => [newRoom, ...prev]);
    setActiveRoom(newRoom);
    setShowNewDM(false);
  };

  // ── Create Group ─────────────────────────────────────────────────────────────
  const createGroup = async () => {
    if (!grpName.trim()) return alert("Enter a group name");
    if (!grpMembers.length) return alert("Select at least one member");
    const room = await apiPost<ChatRoomRow>("/chat_rooms/", {
      name: grpName.trim(),
      type: "group",
      created_by: myId,
    });
    const allMembers = [...new Set([String(myId!), ...grpMembers])];
    await Promise.all(
      allMembers.map((uid) =>
        apiPost("/chat_members/", { room: room.id, user: uid }),
      ),
    );
    const newRoom: ChatRoom = {
      ...room,
      displayName: grpName.trim(),
      memberIds: allMembers,
      lastMsg: null,
      unreadCount: 0,
    };
    setRooms((prev) => [newRoom, ...prev]);
    setActiveRoom(newRoom);
    setShowNewGrp(false);
    setGrpName("");
    setGrpMembers([]);
  };

  const toggleGrpMember = (id: string) =>
    setGrpMembers((m) =>
      m.includes(id) ? m.filter((x) => x !== id) : [...m, id],
    );
  const totalUnread = rooms.reduce((s, r) => s + (r.unreadCount || 0), 0);

  // ── Styles ───────────────────────────────────────────────────────────────────
  const sidebarS = {
    width: 300,
    background: "#1e293b",
    display: "flex",
    flexDirection: "column" as const,
    flexShrink: 0,
    borderRight: "1px solid #0f172a",
  };
  const chatAreaS = {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
    background: "#f8fafc",
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        background: "#f1f5f9",
      }}
    >
      {/* ── Left Sidebar ─────────────────────────────────────────────────────── */}
      <div style={sidebarS}>
        <div
          style={{
            padding: "14px 14px 10px",
            borderBottom: "1px solid #334155",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ color: "#f8fafc", fontWeight: 800, fontSize: 15 }}>
              💬 Chat
              {totalUnread > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 7px",
                  }}
                >
                  {totalUnread}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              onClick={() => setShowNewDM(true)}
              style={{
                flex: 1,
                padding: "6px 0",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              + Direct
            </button>
            <button
              onClick={() => setShowNewGrp(true)}
              style={{
                flex: 1,
                padding: "6px 0",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              + Group
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            style={{
              width: "100%",
              padding: "6px 10px",
              background: "#334155",
              border: "none",
              borderRadius: 6,
              color: "#f1f5f9",
              fontSize: 12,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loadingRooms ? (
            <div
              style={{
                color: "#64748b",
                textAlign: "center",
                padding: 30,
                fontSize: 12,
              }}
            >
              Loading…
            </div>
          ) : filteredRooms.length === 0 ? (
            <div
              style={{
                color: "#64748b",
                textAlign: "center",
                padding: "30px 14px",
                fontSize: 12,
              }}
            >
              {search
                ? "No chats found."
                : "No chats yet.\nClick + Direct or + Group."}
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isActive = activeRoom?.id === room.id;
              const lastSender = room.lastMsg
                ? (profileMap[room.lastMsg.sender]?.full_name || "").split(
                    " ",
                  )[0]
                : "";
              const preview = room.lastMsg
                ? room.lastMsg.message || `📎 ${room.lastMsg.file_name}`
                : "No messages yet";
              return (
                <div
                  key={room.id}
                  onClick={() => setActiveRoom(room)}
                  style={{
                    padding: "10px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid #1e293b",
                    background: isActive ? "#334155" : "transparent",
                    transition: "background .12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "#263347";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 9 }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: room.type === "group" ? 8 : "50%",
                        background:
                          room.type === "group"
                            ? "#7c3aed"
                            : avatarColor(room.displayName),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {room.type === "group"
                        ? "👥"
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
                            fontSize: 13,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {room.displayName}
                        </span>
                        <span
                          style={{
                            color: "#475569",
                            fontSize: 10,
                            flexShrink: 0,
                          }}
                        >
                          {fmtTime(room.lastMsg?.created_at)}
                        </span>
                      </div>
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
                            color: room.unreadCount ? "#94a3b8" : "#475569",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontWeight: room.unreadCount ? 600 : 400,
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
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "1px 6px",
                              flexShrink: 0,
                              minWidth: 18,
                              textAlign: "center",
                            }}
                          >
                            {room.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Chat area ─────────────────────────────────────────────────── */}
      {activeRoom ? (
        <div style={chatAreaS}>
          <div
            style={{
              padding: "11px 18px",
              background: "#fff",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
              boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: activeRoom.type === "group" ? 8 : "50%",
                background:
                  activeRoom.type === "group"
                    ? "#7c3aed"
                    : avatarColor(activeRoom.displayName),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {activeRoom.type === "group"
                ? "👥"
                : initials(activeRoom.displayName)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
                {activeRoom.displayName}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {activeRoom.type === "group"
                  ? `Group · ${activeRoom.memberIds?.length || 0} members: ${(
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
                  : "🔒 Direct message · only the two of you"}
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {loadingMsgs ? (
              <div
                style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}
              >
                Loading messages…
              </div>
            ) : messages.length === 0 ? (
              <div
                style={{
                  color: "#94a3b8",
                  textAlign: "center",
                  padding: 40,
                  fontSize: 14,
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
                  const showAvatar = !isMe && !sameAuthor;
                  const showName = !isMe && !sameAuthor;
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            margin: "10px 0 6px",
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
                              fontSize: 11,
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
                          gap: 8,
                          marginTop: sameAuthor && !showDate ? 2 : 8,
                        }}
                      >
                        {!isMe && (
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              background: avatarColor(senderName),
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: 12,
                              visibility: showAvatar ? "visible" : "hidden",
                            }}
                          >
                            {initials(senderName)}
                          </div>
                        )}
                        <div
                          style={{
                            maxWidth: "65%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: isMe ? "flex-end" : "flex-start",
                          }}
                        >
                          {showName && (
                            <span
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 3,
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
                                ? "14px 14px 3px 14px"
                                : "14px 14px 14px 3px",
                              padding: "9px 13px",
                              boxShadow: "0 1px 4px rgba(0,0,0,.10)",
                              fontSize: 13,
                              lineHeight: 1.5,
                              wordBreak: "break-word",
                              maxWidth: "100%",
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
                                  gap: 9,
                                  padding: "6px 8px",
                                  borderRadius: 8,
                                  background: isMe
                                    ? "rgba(255,255,255,.15)"
                                    : "#f1f5f9",
                                  border: `1px solid ${isMe ? "rgba(255,255,255,.2)" : "#e2e8f0"}`,
                                }}
                              >
                                <span style={{ fontSize: 22, flexShrink: 0 }}>
                                  {isImage(msg.file_type || "") ? "🖼" : "📄"}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      maxWidth: 180,
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
                                    fontSize: 11,
                                    color: isMe ? "#bfdbfe" : "#2563eb",
                                    fontWeight: 600,
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
                              fontSize: 10,
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

          <div
            style={{
              padding: "12px 18px",
              background: "#fff",
              borderTop: "1px solid #e2e8f0",
              flexShrink: 0,
            }}
          >
            <form
              onSubmit={sendMessage}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Attach file"
                style={{
                  padding: "9px 11px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  background: "#f8fafc",
                  cursor: "pointer",
                  fontSize: 17,
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
                  if (e.target.files?.[0]) {
                    sendFile(e.target.files[0]);
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
                placeholder={`Message ${activeRoom.displayName}…`}
                style={{
                  flex: 1,
                  padding: "9px 14px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 13,
                  outline: "none",
                  background: "#f8fafc",
                  color: "#1e293b",
                }}
              />
              <button
                type="submit"
                disabled={!newMsg.trim() || sending}
                style={{
                  padding: "9px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 14,
                  flexShrink: 0,
                  opacity: !newMsg.trim() || sending ? 0.5 : 1,
                }}
              >
                ➤
              </button>
            </form>
            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                marginTop: 5,
                textAlign: "center",
              }}
            >
              Press Enter to send · Shift+Enter for new line · 📎 to attach
              files
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
            gap: 14,
          }}
        >
          <div style={{ fontSize: 56 }}>💬</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
            Welcome to Chat
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              textAlign: "center",
              maxWidth: 320,
            }}
          >
            Send messages, share files, and collaborate with your team.
            <br />
            All messages are stored securely and kept for long-term reference.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button
              onClick={() => setShowNewDM(true)}
              style={{
                padding: "10px 22px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              💬 New Direct Message
            </button>
            <button
              onClick={() => setShowNewGrp(true)}
              style={{
                padding: "10px 22px",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              👥 Create Group
            </button>
          </div>
        </div>
      )}

      {/* ── New DM Modal ─────────────────────────────────────────────────────── */}
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
          onClick={(e) => e.target === e.currentTarget && setShowNewDM(false)}
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
                    onClick={() => createDM(String(p.id))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      border: "1.5px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: avatarColor(p.full_name || p.name || ""),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {initials(p.full_name || p.name || "")}
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "#1e293b",
                      }}
                    >
                      {p.full_name || p.name}
                    </span>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => setShowNewDM(false)}
              style={{
                marginTop: 14,
                padding: "8px 0",
                background: "#f1f5f9",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                color: "#64748b",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── New Group Modal ───────────────────────────────────────────────────── */}
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
          onClick={(e) => e.target === e.currentTarget && setShowNewGrp(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 24,
              width: 400,
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
              👥 Create Group
            </div>
            <input
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              placeholder="Group name…"
              style={{
                padding: "9px 12px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 12,
                outline: "none",
              }}
            />
            <div
              style={{
                fontSize: 12,
                color: "#64748b",
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              Select members:
            </div>
            <div
              style={{
                overflowY: "auto",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              {otherUsers.map((p) => {
                const sel = grpMembers.includes(String(p.id));
                return (
                  <div
                    key={p.id}
                    onClick={() => toggleGrpMember(String(p.id))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      border: `1.5px solid ${sel ? "#2563eb" : "#e2e8f0"}`,
                      background: sel ? "#eff6ff" : "#fff",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: avatarColor(p.full_name || p.name || ""),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {initials(p.full_name || p.name || "")}
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#1e293b",
                        flex: 1,
                      }}
                    >
                      {p.full_name || p.name}
                    </span>
                    {sel && (
                      <span style={{ color: "#2563eb", fontSize: 16 }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setShowNewGrp(false)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "#64748b",
                }}
              >
                Cancel
              </button>
              <button
                onClick={createGroup}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
