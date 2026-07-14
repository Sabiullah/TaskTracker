import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  ApiError,
  apiGet,
  apiPost,
  ws,
} from "@/lib/api";
import ForwardModal from "@/components/chat/ForwardModal";
import NewDMModal from "@/components/chat/NewDMModal";
import NewGroupModal from "@/components/chat/NewGroupModal";
import AddMembersModal from "@/components/chat/AddMembersModal";
import NewSubgroupModal from "@/components/chat/NewSubgroupModal";
import ChatContextMenu from "@/components/chat/ChatContextMenu";
import ChatPanel from "@/components/chat/ChatPanel";
import ChatSidebar from "@/components/chat/ChatSidebar";
import type { ChatMessage, ChatRoom, Profile } from "@/types";
import type {
  ChatMemberDto,
  ChatMessageDto,
  ChatRoomAddMemberRequest,
  ChatRoomCreate,
  ChatRoomDto,
} from "@/types/api";
import { useChat } from "@/hooks/useChat";

interface FloatingChatProps {
  profile: Profile | null;
  profiles: Profile[];
}

export default function FloatingChat({ profile, profiles }: FloatingChatProps) {
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

  const [open, setOpen] = useState(false);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteFile, setPasteFile] = useState<File | null>(null);
  const [pastePreviewUrl, setPastePreviewUrl] = useState("");
  const [sideSearch, setSideSearch] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: ChatMessage;
  } | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);

  const [showDM, setShowDM] = useState(false);
  const [showGrp, setShowGrp] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showAddMbr, setShowAddMbr] = useState(false);

  const [grpName, setGrpName] = useState("");
  const [grpMembers, setGrpMembers] = useState<string[]>([]);
  const [subName, setSubName] = useState("");
  const [subMembers, setSubMembers] = useState<string[]>([]);
  const [addMembers, setAddMembers] = useState<string[]>([]);

  const playNotifSound = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
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
      osc.onended = () => {
        void ctx.close();
      };
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
          (a.full_name || "").localeCompare(b.full_name || ""),
        ),
    [profiles, myId],
  );

  useEffect(() => {
    if (open) void loadRooms();
  }, [open, loadRooms]);

  // Global notification sound for any incoming message not sent by me.
  useEffect(() => {
    if (!myId) return;
    const unsubscribe = ws.subscribe<ChatMessageDto>("chat-messages", (evt) => {
      if (evt.event !== "INSERT" || !evt.record) return;
      if (evt.record.sender_detail.uid !== myId) playNotifSound();
    });
    return unsubscribe;
  }, [myId, playNotifSound]);

  // Read-receipts for the active DM room.
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

  const clearPaste = (): void => {
    if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
    setPasteFile(null);
    setPastePreviewUrl("");
  };

  const sendMessage = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault();
    const text = newMsg.trim();
    if (!text && !pasteFile) return;
    if (!activeRoom || sending) return;
    setSending(true);
    setNewMsg("");
    const replyId = replyTo?.id || null;
    setReplyTo(null);
    if (pasteFile) {
      const file = pasteFile;
      clearPaste();
      setUploading(true);
      try {
        await sendFileApi(file);
      } finally {
        setUploading(false);
      }
    }
    if (text) {
      await sendMessageApi(text, replyId);
    }
    setSending(false);
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

  const handlePaste = (e: ClipboardEvent): void => {
    const imgItem = [...(e.clipboardData?.items || [])].find((it) =>
      it.type.startsWith("image/"),
    );
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
        setShowDM(false);
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
        setShowDM(false);
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
      setShowGrp(false);
      setGrpName("");
      setGrpMembers([]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Create group failed: ${msg}`);
    }
  }, [myId, grpName, grpMembers, setActiveRoom, loadRooms]);

  const addMembersToGroup = useCallback(async (): Promise<void> => {
    if (!activeRoom) return;
    if (!addMembers.length) {
      alert("Select at least one member to add");
      return;
    }
    try {
      await Promise.all(
        addMembers.map((uid) => {
          const body: ChatRoomAddMemberRequest = { user_uid: uid };
          return apiPost<unknown>(
            `/chat_rooms/${activeRoom.id}/add_member/`,
            body,
          );
        }),
      );
      const updatedIds = [
        ...new Set([...activeRoom.memberIds, ...addMembers]),
      ];
      const updatedRoom: ChatRoom = { ...activeRoom, memberIds: updatedIds };
      setActiveRoom(updatedRoom);
      setRooms((prev) =>
        prev.map((r) => (r.id === activeRoom.id ? updatedRoom : r)),
      );
      setShowAddMbr(false);
      setAddMembers([]);
      await loadRooms();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Add members failed: ${msg}`);
    }
  }, [activeRoom, addMembers, setActiveRoom, setRooms, loadRooms]);

  const createSubGroup = useCallback(async (): Promise<void> => {
    if (!activeRoom || !myId) return;
    if (!subName.trim()) {
      alert("Enter a subgroup name");
      return;
    }
    if (!subMembers.length) {
      alert("Select at least one member");
      return;
    }
    try {
      const memberUids = [...new Set([myId, ...subMembers])];
      const body: ChatRoomCreate = {
        name: subName.trim(),
        type: "group",
        parent_room: activeRoom.id as unknown as number,
        member_uids: memberUids,
      };
      const dto = await apiPost<ChatRoomDto>("/chat_rooms/", body);
      await loadRooms();
      const newRoom: ChatRoom = {
        id: dto.uid,
        name: dto.name,
        type: dto.type,
        parent_room_id: activeRoom.id,
        created_by: dto.created_by_detail?.uid ?? myId,
        created_at: dto.created_at,
        displayName: subName.trim(),
        memberIds: memberUids,
        unreadCount: 0,
        lastMsg: null,
      };
      setActiveRoom(newRoom);
      setShowSub(false);
      setSubName("");
      setSubMembers([]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Create subgroup failed: ${msg}`);
    }
  }, [activeRoom, myId, subName, subMembers, setActiveRoom, loadRooms]);

  const filteredRooms = useMemo(() => {
    const q = sideSearch.toLowerCase().trim();
    return q
      ? rooms.filter((r) => r.displayName?.toLowerCase().includes(q))
      : rooms;
  }, [rooms, sideSearch]);

  const topLevel = useMemo(
    () => filteredRooms.filter((r) => !r.parent_room_id),
    [filteredRooms],
  );

  const subMap = useMemo(() => {
    const m: Record<string, ChatRoom[]> = {};
    filteredRooms
      .filter((r) => r.parent_room_id)
      .forEach((r) => {
        const parent = r.parent_room_id ?? "";
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
    (room: ChatRoom) => {
      setActiveRoom(room);
      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r)),
      );
      if (room.type === "group" && !room.parent_room_id) {
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          next.add(room.id);
          return next;
        });
      }
    },
    [setActiveRoom, setRooms],
  );

  const toggleMember = useCallback(
    (setter: Dispatch<SetStateAction<string[]>>, id: string) =>
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
          (a.full_name || "").localeCompare(b.full_name || ""),
        ),
    [otherUsers, activeRoom],
  );

  const parentMembers = useMemo(
    () =>
      otherUsers
        .filter((p) => (activeRoom?.memberIds || []).includes(p.id))
        .sort((a, b) =>
          (a.full_name || "").localeCompare(b.full_name || ""),
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
      <button
        onClick={() => setOpen((o) => !o)}
        title="Team Chat"
        className="fab-bubble fab-bubble-chat"
        style={{
          position: "fixed",
          top: 8,
          left: "calc(50% + 24px)",
          zIndex: 9000,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1.5px solid rgba(255,255,255,.85)",
          background: open ? "#15803d" : "#16a34a",
          color: "#fff",
          fontSize: 16,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(22,163,74,.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s,transform .15s",
          transform: open ? "scale(1.05)" : "scale(1)",
        }}
      >
        💬
        {totalUnread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#ef4444",
              color: "#fff",
              fontSize: 9,
              fontWeight: 800,
              borderRadius: "50%",
              minWidth: 15,
              height: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
              padding: "0 3px",
            }}
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fab-panel fab-panel-chat"
          style={{
            position: "fixed",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 8999,
            width: PW,
            height: PH,
            borderRadius: 14,
            boxShadow: "0 12px 48px rgba(0,0,0,.18)",
            display: "flex",
            overflow: "hidden",
            border: "1px solid #d1fae5",
          }}
        >
          <ChatSidebar
            topLevel={topLevel}
            subMap={subMap}
            activeRoom={activeRoom}
            profileMap={profileMap}
            expandedGroups={expandedGroups}
            sideSearch={sideSearch}
            totalUnread={totalUnread}
            onRoomClick={handleRoomClick}
            onToggleExpand={handleToggleExpand}
            onSearchChange={setSideSearch}
            onClose={() => setOpen(false)}
            onNewDM={() => setShowDM(true)}
            onNewGroup={() => setShowGrp(true)}
          />

          {activeRoom ? (
            <ChatPanel
              messages={messages}
              activeRoom={activeRoom}
              profile={profile}
              profileMap={profileMap}
              rooms={rooms}
              newMsg={newMsg}
              sending={sending}
              uploading={uploading}
              replyTo={replyTo}
              pasteFile={pasteFile}
              pastePreviewUrl={pastePreviewUrl}
              otherReadAt={otherReadAt}
              loadingMsgs={loadingMsgs}
              onNewMsgChange={setNewMsg}
              onSend={sendMessage}
              onSendFile={sendFile}
              onSetReplyTo={setReplyTo}
              onClearPaste={clearPaste}
              onPaste={handlePaste}
              onContextMenu={(e, msg) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, msg });
              }}
              onAddMembers={() => {
                setAddMembers([]);
                setShowAddMbr(true);
              }}
              onCreateSubgroup={() => {
                setSubName("");
                setSubMembers([]);
                setShowSub(true);
              }}
            />
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
              <div
                style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}
              >
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

      {showDM && (
        <NewDMModal
          otherUsers={otherUsers}
          onClose={() => setShowDM(false)}
          onCreateDM={(otherId) => {
            void createDM(otherId);
          }}
        />
      )}

      {showGrp && (
        <NewGroupModal
          grpName={grpName}
          setGrpName={setGrpName}
          grpMembers={grpMembers}
          setGrpMembers={setGrpMembers}
          otherUsers={otherUsers}
          onClose={() => {
            setShowGrp(false);
            setGrpName("");
            setGrpMembers([]);
          }}
          onCreate={() => {
            void createGroup();
          }}
          toggleMember={toggleMember}
        />
      )}

      {showAddMbr && (
        <AddMembersModal
          addMembers={addMembers}
          setAddMembers={setAddMembers}
          nonMembers={nonMembers}
          activeRoom={activeRoom}
          onClose={() => {
            setShowAddMbr(false);
            setAddMembers([]);
          }}
          onAdd={() => {
            void addMembersToGroup();
          }}
          toggleMember={toggleMember}
        />
      )}

      {showSub && (
        <NewSubgroupModal
          subName={subName}
          setSubName={setSubName}
          subMembers={subMembers}
          setSubMembers={setSubMembers}
          parentMembers={parentMembers}
          activeRoom={activeRoom}
          onClose={() => {
            setShowSub(false);
            setSubName("");
            setSubMembers([]);
          }}
          onCreate={() => {
            void createSubGroup();
          }}
          toggleMember={toggleMember}
        />
      )}

      {contextMenu && (
        <ChatContextMenu
          contextMenu={contextMenu}
          onClose={() => setContextMenu(null)}
          onReply={() => {
            setReplyTo(contextMenu.msg);
            setContextMenu(null);
          }}
          onForward={() => {
            setForwardMsg(contextMenu.msg);
            setContextMenu(null);
          }}
        />
      )}

      {forwardMsg && (
        <ForwardModal
          forwardMsg={forwardMsg}
          rooms={rooms}
          activeRoom={activeRoom}
          myId={myId ?? ""}
          profiles={profiles}
          onDone={() => {
            setForwardMsg(null);
            void loadRooms();
          }}
          onClose={() => setForwardMsg(null)}
        />
      )}
    </>
  );
}
