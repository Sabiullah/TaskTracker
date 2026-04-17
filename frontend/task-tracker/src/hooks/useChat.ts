import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ApiError,
  apiGet,
  apiPost,
  apiPostForm,
  ws,
} from "@/lib/api";
import type { ChatMessage, ChatRoom, ID } from "@/types";
import type {
  ChatMessageCreate,
  ChatMessageDto,
  ChatRoomDto,
} from "@/types/api";

// ─── DTO → Domain mappers ────────────────────────────────────────────────────

function dtoToChatMessage(dto: ChatMessageDto): ChatMessage {
  return {
    id: dto.uid,
    room_id: String(dto.room),
    sender_id: dto.sender_detail.uid,
    message: dto.message,
    file_path: dto.file_url,
    file_name: dto.file_url ? extractFileName(dto.file_url) : null,
    file_type: dto.file_type || null,
    file_size: dto.file_size,
    reply_to_id: dto.reply_to ? String(dto.reply_to) : null,
    created_at: dto.created_at,
  };
}

function extractFileName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

function dtoToChatRoom(dto: ChatRoomDto, myId: ID | undefined): ChatRoom {
  const memberIds = dto.members.map((m) => m.user_detail.uid);
  let displayName = dto.name;
  if (dto.type === "direct" && myId) {
    const other = dto.members.find((m) => m.user_detail.uid !== myId);
    displayName = other?.user_detail.full_name || "Unknown";
  }
  return {
    id: dto.uid,
    name: dto.name,
    type: dto.type,
    parent_room_id: dto.parent_room ? String(dto.parent_room) : null,
    created_by: dto.created_by_detail?.uid ?? "",
    created_at: dto.created_at,
    displayName,
    memberIds,
    unreadCount: 0,
    lastMsg: null,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseChatReturn {
  rooms: ChatRoom[];
  messages: ChatMessage[];
  activeRoom: ChatRoom | null;
  loading: boolean;
  sendMessage: (text: string, replyToId?: ID | null) => Promise<void>;
  sendFile: (file: File) => Promise<void>;
  setActiveRoom: (room: ChatRoom | null) => void;
  loadRooms: () => Promise<void>;
  loadMessages: (roomId: ID) => Promise<void>;
  setRooms: Dispatch<SetStateAction<ChatRoom[]>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export function useChat(myId: ID | undefined): UseChatReturn {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeRoom, setActiveRoomState] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRoomRef = useRef<ChatRoom | null>(null);

  const loadRooms = useCallback(async (): Promise<void> => {
    if (!myId) {
      setRooms([]);
      return;
    }
    const dtos = await apiGet<ChatRoomDto[]>("/chat_rooms/");
    setRooms(dtos.map((d) => dtoToChatRoom(d, myId)));
  }, [myId]);

  const loadMessages = useCallback(
    async (roomId: ID): Promise<void> => {
      setLoading(true);
      try {
        const dtos = await apiGet<ChatMessageDto[]>("/chat_messages/", {
          room_uid: roomId,
        });
        setMessages(dtos.map(dtoToChatMessage));
        try {
          await apiPost<unknown>(`/chat_rooms/${roomId}/mark_read/`, {});
        } catch {
          /* non-fatal */
        }
        // Mark room unread count back to 0 locally.
        setRooms((prev) =>
          prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)),
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const setActiveRoom = useCallback(
    (room: ChatRoom | null): void => {
      setActiveRoomState(room);
      activeRoomRef.current = room;
      if (room) void loadMessages(room.id);
    },
    [loadMessages],
  );

  // Subscribe to real-time chat messages for any room we're a member of. The
  // server filters by visibility — we just route into the active list vs.
  // unread counters.
  useEffect(() => {
    if (!myId) return;

    const unsubscribe = ws.subscribe<ChatMessageDto>("chat-messages", (evt) => {
      if (evt.event !== "INSERT" || !evt.record) return;
      const msg = dtoToChatMessage(evt.record);
      const active = activeRoomRef.current;
      if (active && msg.room_id === active.id) {
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
        // Mark-read for the active room.
        void apiPost<unknown>(`/chat_rooms/${active.id}/mark_read/`, {}).catch(
          () => {
            /* non-fatal */
          },
        );
      } else if (msg.sender_id !== myId) {
        setRooms((prev) =>
          prev.map((r) =>
            r.id === msg.room_id
              ? {
                  ...r,
                  unreadCount: r.unreadCount + 1,
                  lastMsg: {
                    message: msg.message,
                    file_name: msg.file_name ?? undefined,
                    created_at: msg.created_at,
                    sender_id: msg.sender_id,
                  },
                }
              : r,
          ),
        );
      }
    });

    return unsubscribe;
  }, [myId]);

  const sendMessage = useCallback(
    async (text: string, replyToId?: ID | null): Promise<void> => {
      if (!text.trim() || !activeRoomRef.current || !myId) return;
      const body: ChatMessageCreate = {
        // The Django serializer accepts either room uid or pk — we send the uid
        // as it's what our domain carries. Cast because the DTO types `room`
        // as `Pk`; see docs/realtime_channels.md for the migration plan.
        room: activeRoomRef.current.id as unknown as number,
        message: text,
        reply_to: replyToId ? (replyToId as unknown as number) : null,
      };
      try {
        await apiPost<ChatMessageDto>("/chat_messages/", body);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Send failed: ${msg}`);
      }
    },
    [myId],
  );

  const sendFile = useCallback(
    async (file: File): Promise<void> => {
      if (!file || !activeRoomRef.current || !myId) return;
      try {
        const fd = new FormData();
        fd.append("room", activeRoomRef.current.id);
        fd.append("file", file);
        await apiPostForm<ChatMessageDto>("/chat_messages/", fd);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Upload failed: ${msg}`);
      }
    },
    [myId],
  );

  return {
    rooms,
    messages,
    activeRoom,
    loading,
    sendMessage,
    sendFile,
    setActiveRoom,
    loadRooms,
    loadMessages,
    setRooms,
    setMessages,
  };
}
