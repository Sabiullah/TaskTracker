import type { Profile } from "./auth";

export interface ChatMessage {
  id: string;
  room: string;
  sender: string;
  message?: string;
  file_path?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  created_at: string;
}

export interface ChatRoom {
  id: string;
  name?: string;
  type: "direct" | "group";
  created_by: string;
  created_at: string;
  displayName: string;
  parent_room?: string | null;
  lastMsg?: ChatMessage | null;
  memberIds: string[];
  unreadCount: number;
}

export interface ChatRoomRow {
  id: string;
  name?: string;
  type: "direct" | "group";
  created_by: string;
  created_at: string;
  parent_room?: string | null;
}

export interface ChatMemberRow {
  id: string;
  room: string;
  user: string;
  last_read_at: string | null;
}

export interface ChatMember {
  id: string;
  room: string;
  user: string;
  last_read_at: string | null;
}

export interface ChatPageProps {
  profile: Profile | null;
  profiles: Profile[];
}

// ── FloatingChat internal sub-component props ─────────────────────────────────

import type { ReactNode } from "react";

export interface AvatarDivProps {
  name?: string;
  size?: number;
  radius?: string;
  icon?: ReactNode;
}

export interface ModalWrapProps {
  onClose: () => void;
  children: ReactNode;
}

export interface MemberListProps {
  available: Profile[];
  selected: string[];
  onToggle: (id: string) => void;
}

export interface RoomRowProps {
  room: ChatRoom;
  isActive: boolean;
  onClick: (room: ChatRoom) => void;
  subMap: Record<string, ChatRoom[]>;
  profileMap: Record<string, Profile>;
  activeRoomId?: string | null;
  expandedGroups: Set<string>;
  onToggleExpand: (roomId: string) => void;
  indent?: boolean;
}
