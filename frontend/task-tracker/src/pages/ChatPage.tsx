import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ApiError,
  apiGet,
  apiPost,
} from "@/lib/api";
import { fmtTime } from "@/utils/date";
import { avatarColor, initials } from "@/utils/avatar";
import ChatMessageList from "@/components/chat/ChatMessageList";
import ChatModals from "@/components/chat/ChatModals";
import type { ChatRoom, Profile } from "@/types";
import type {
  ChatMemberDto,
  ChatRoomCreate,
  ChatRoomDto,
} from "@/types/api";
import { useChat } from "@/hooks/useChat";

interface ChatPageProps {
  profile: Profile | null;
  profiles: Profile[];
}

export default function ChatPage({ profile, profiles }: ChatPageProps) {
  const myId = profile?.id;
  const {
    rooms,
    messages,
    activeRoom,
    loading: loadingMsgs,
    sendMessage: sendMessageApi,
    sendFile: sendFileApi,
    setActiveRoom,
    loadRooms,
    setRooms,
  } = useChat(myId);

  const [loadingRooms, setLoadingRooms] = useState(true);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGrp, setShowNewGrp] = useState(false);
  const [grpName, setGrpName] = useState("");
  const [grpMembers, setGrpMembers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const profileMap = useMemo(
    () => Object.fromEntries((profiles || []).map((p) => [p.id, p])),
    [profiles],
  );
  const otherUsers = useMemo(
    () => (profiles || []).filter((p) => p.id !== myId),
    [profiles, myId],
  );
  const filteredRooms = useMemo(() => {
    if (!search.trim()) return rooms;
    return rooms.filter((r) =>
      r.displayName?.toLowerCase().includes(search.toLowerCase()),
    );
  }, [rooms, search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRooms();
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRooms]);

  // Fetch other member's read-timestamp for DM read-receipts whenever the
  // active room changes.
  useEffect(() => {
    if (!activeRoom || !myId) {
      setOtherReadAt(null);
      return;
    }
    if (activeRoom.type !== "direct") {
      setOtherReadAt(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const members = await apiGet<ChatMemberDto[]>("/chat_members/", {
          room_uid: activeRoom.id,
        });
        if (cancelled) return;
        const other = members.find((m) => m.user_detail.uid !== myId);
        setOtherReadAt(other?.last_read_at ?? null);
      } catch {
        if (!cancelled) setOtherReadAt(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRoom, myId]);

  const sendMessage = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault();
    const text = newMsg.trim();
    if (!text || !activeRoom || sending) return;
    setSending(true);
    setNewMsg("");
    await sendMessageApi(text);
    setSending(false);
    inputRef.current?.focus();
  };

  const sendFile = async (file: File): Promise<void> => {
    if (!file || !activeRoom) return;
    setUploading(true);
    try {
      await sendFileApi(file);
    } finally {
      setUploading(false);
    }
  };

  const createDM = useCallback(
    async (otherId: string): Promise<void> => {
      if (!myId) return;
      const existing = rooms.find(
        (r) =>
          r.type === "direct" &&
          r.memberIds.includes(myId) &&
          r.memberIds.includes(otherId),
      );
      if (existing) {
        setActiveRoom(existing);
        setShowNewDM(false);
        return;
      }
      try {
        const body: ChatRoomCreate = {
          name: "",
          type: "direct",
          member_uids: [myId, otherId],
        };
        const dto = await apiPost<ChatRoomDto>("/chat_rooms/", body);
        await loadRooms();
        const other = profileMap[otherId];
        const newRoom: ChatRoom = {
          id: dto.uid,
          name: dto.name,
          type: dto.type,
          parent_room_id: dto.parent_room ? String(dto.parent_room) : null,
          created_by: dto.created_by_detail?.uid ?? myId,
          created_at: dto.created_at,
          displayName: other?.full_name || "Unknown",
          memberIds: [myId, otherId],
          unreadCount: 0,
          lastMsg: null,
        };
        setActiveRoom(newRoom);
        setShowNewDM(false);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Create DM failed: ${msg}`);
      }
    },
    [myId, rooms, setActiveRoom, loadRooms, profileMap],
  );

  const createGroup = useCallback(async (): Promise<void> => {
    if (!myId) return;
    if (!grpName.trim()) {
      alert("Enter a group name");
      return;
    }
    if (!grpMembers.length) {
      alert("Select at least one member");
      return;
    }
    try {
      const memberUids = [...new Set([myId, ...grpMembers])];
      const body: ChatRoomCreate = {
        name: grpName.trim(),
        type: "group",
        member_uids: memberUids,
      };
      const dto = await apiPost<ChatRoomDto>("/chat_rooms/", body);
      await loadRooms();
      const newRoom: ChatRoom = {
        id: dto.uid,
        name: dto.name,
        type: dto.type,
        parent_room_id: dto.parent_room ? String(dto.parent_room) : null,
        created_by: dto.created_by_detail?.uid ?? myId,
        created_at: dto.created_at,
        displayName: grpName.trim(),
        memberIds: memberUids,
        unreadCount: 0,
        lastMsg: null,
      };
      setActiveRoom(newRoom);
      setShowNewGrp(false);
      setGrpName("");
      setGrpMembers([]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Create group failed: ${msg}`);
    }
  }, [myId, grpName, grpMembers, setActiveRoom, loadRooms]);

  const toggleGrpMember = (id: string): void =>
    setGrpMembers((m) =>
      m.includes(id) ? m.filter((x) => x !== id) : [...m, id],
    );

  const totalUnread = rooms.reduce((s, r) => s + (r.unreadCount || 0), 0);

  const sidebarS: CSSProperties = {
    width: 300,
    background: "#1e293b",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    borderRight: "1px solid #0f172a",
  };
  const chatAreaS: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
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
      {/* Left Sidebar */}
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
            <div
              style={{ color: "#f8fafc", fontWeight: 800, fontSize: 15 }}
            >
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
                ? (profileMap[room.lastMsg.sender_id]?.full_name || "").split(
                    " ",
                  )[0]
                : "";
              const preview = room.lastMsg
                ? room.lastMsg.message || `📎 ${room.lastMsg.file_name}`
                : "No messages yet";
              return (
                <div
                  key={room.id}
                  onClick={() => {
                    setActiveRoom(room);
                    setRooms((prev) =>
                      prev.map((r) =>
                        r.id === room.id ? { ...r, unreadCount: 0 } : r,
                      ),
                    );
                  }}
                  style={{
                    padding: "10px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid #1e293b",
                    background: isActive ? "#334155" : "transparent",
                    transition: "background .12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "#263347";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                    }}
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
                            color: room.unreadCount
                              ? "#94a3b8"
                              : "#475569",
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

      {/* Right: Chat area */}
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
              <div
                style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}
              >
                {activeRoom.displayName}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {activeRoom.type === "group"
                  ? `Group · ${activeRoom.memberIds?.length || 0} members: ${(
                      activeRoom.memberIds || []
                    )
                      .map(
                        (id) =>
                          (profileMap[id]?.full_name || "").split(" ")[0],
                      )
                      .filter(Boolean)
                      .join(", ")}`
                  : "🔒 Direct message · only the two of you"}
              </div>
            </div>
          </div>

          <ChatMessageList
            messages={messages}
            activeRoom={activeRoom}
            profile={profile}
            profileMap={profileMap}
            otherReadAt={otherReadAt}
            loadingMsgs={loadingMsgs}
          />

          <div
            style={{
              padding: "12px 18px",
              background: "#fff",
              borderTop: "1px solid #e2e8f0",
              flexShrink: 0,
            }}
          >
            <form
              onSubmit={(e) => {
                void sendMessage(e);
              }}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Attach file (image, PDF, Excel, etc.)"
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
                  const file = e.target.files?.[0];
                  if (file) {
                    void sendFile(file);
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
                    void sendMessage();
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

      <ChatModals
        showNewDM={showNewDM}
        showNewGrp={showNewGrp}
        otherUsers={otherUsers}
        grpName={grpName}
        grpMembers={grpMembers}
        onCreateDM={(otherId) => {
          void createDM(otherId);
        }}
        onCreateGroup={() => {
          void createGroup();
        }}
        onCloseDM={() => setShowNewDM(false)}
        onCloseGrp={() => {
          setShowNewGrp(false);
          setGrpName("");
          setGrpMembers([]);
        }}
        onGrpNameChange={setGrpName}
        onToggleGrpMember={toggleGrpMember}
      />
    </div>
  );
}
