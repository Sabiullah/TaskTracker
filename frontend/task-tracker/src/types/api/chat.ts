/**
 * Chat DTOs — mirrors `/api/chat_rooms/`, `/api/chat_members/`, and
 * `/api/chat_messages/`.
 *
 * `file_url` on `ChatMessageDto` is a short-lived signed URL — same semantics
 * as `InvoiceEntryDto.file_url`. Never cache it.
 *
 * `DELETE /api/chat_messages/<id>/` is a soft-delete: the server flips
 * `is_deleted` to `true` and blanks `message`/`file_*`. The row stays.
 */

import type {
  BaseDto,
  IsoDateTime,
  Pk,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `ChatRoom.type`. */
export type ChatRoomTypeValue = "direct" | "group";

/** Embedded member info on `ChatRoomDto.members`. */
export interface ChatRoomMemberDto {
  readonly id: Pk;
  readonly user_detail: UserRefDto;
  readonly joined_at: IsoDateTime;
  readonly last_read_at: IsoDateTime | null;
}

/** Full chat-room payload. */
export interface ChatRoomDto extends BaseDto {
  readonly name: string;
  readonly type: ChatRoomTypeValue;
  readonly parent_room: Pk | null;
  readonly members: readonly ChatRoomMemberDto[];
  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/chat_rooms/`. */
export interface ChatRoomCreate {
  readonly name: string;
  readonly type: ChatRoomTypeValue;
  readonly parent_room?: Pk | null;
  readonly member_uids?: readonly Uid[];
}

/** Body for `PATCH /api/chat_rooms/<id>/`. */
export type ChatRoomUpdate = Partial<ChatRoomCreate>;

/** Body for `POST /api/chat_rooms/<id>/add_member/`. */
export interface ChatRoomAddMemberRequest {
  readonly user_uid: Uid;
}

/** Full chat-member row (read-only endpoint `/api/chat_members/`). */
export interface ChatMemberDto {
  readonly id: Pk;
  readonly room: Pk;
  readonly user_detail: UserRefDto;
  readonly joined_at: IsoDateTime;
  readonly last_read_at: IsoDateTime | null;
}

/** Full chat-message payload. */
export interface ChatMessageDto extends BaseDto {
  readonly room: Pk;
  readonly sender_detail: UserRefDto;
  readonly message: string;
  readonly reply_to: Pk | null;
  /** Short-lived signed URL. */
  readonly file_url: string | null;
  readonly file_type: string;
  readonly file_size: number | null;
  readonly is_deleted: boolean;
}

/**
 * Body for `POST /api/chat_messages/`. For file uploads use multipart with a
 * `file` part; server fills `file_url`, `file_type`, `file_size`.
 */
export interface ChatMessageCreate {
  readonly room: Pk;
  readonly message?: string;
  readonly reply_to?: Pk | null;
}
