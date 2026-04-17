import type { ID } from "./common";

export type RoomType = "direct" | "group";

export interface ChatRoom {
  id: ID;
  name: string;
  type: RoomType;
  parent_room_id: ID | null;
  created_by: ID;
  created_at?: string;
  // Enriched fields — populated by loadRooms, required at runtime
  displayName: string;
  memberIds: ID[];
  unreadCount: number;
  lastMsg?: {
    message?: string;
    file_name?: string;
    created_at: string;
    sender_id: ID;
  } | null;
}

export interface ChatMember {
  room_id: ID;
  user_id: ID;
  last_read_at: string | null;
}

export interface ChatMessage {
  id: ID;
  room_id: ID;
  sender_id: ID;
  message: string;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  reply_to_id: ID | null;
  created_at: string;
}

/** Shape of the right-click context menu state */
export interface ChatContextMenuState {
  x: number;
  y: number;
  msg: ChatMessage;
}
