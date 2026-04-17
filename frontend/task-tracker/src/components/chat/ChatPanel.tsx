import React, { useRef, useEffect } from "react";
import { apiGet } from "@/lib/api";
import type { ChatMessageDto } from "@/types/api";
import type { Profile, ChatMessage, ChatRoom } from "@/types";
import { avatarColor, initials } from "@/utils/avatar";
import { isImage, fmtSize } from "@/utils/chat";
import { fmtFull } from "@/utils/date";

export interface ChatPanelProps {
  messages: ChatMessage[];
  activeRoom: ChatRoom;
  profile: Profile | null;
  profileMap: Record<string, Profile>;
  rooms: ChatRoom[];
  newMsg: string;
  sending: boolean;
  uploading: boolean;
  replyTo: ChatMessage | null;
  pasteFile: File | null;
  pastePreviewUrl: string;
  otherReadAt: string | null;
  loadingMsgs: boolean;
  onNewMsgChange: (v: string) => void;
  onSend: (e?: React.FormEvent<HTMLFormElement>) => void;
  onSendFile: (file: File) => void;
  onSetReplyTo: (msg: ChatMessage | null) => void;
  onClearPaste: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onContextMenu: (e: React.MouseEvent, msg: ChatMessage) => void;
  onAddMembers?: () => void;
  onCreateSubgroup?: () => void;
}

export default function ChatPanel({
  messages,
  activeRoom,
  profile,
  profileMap,
  rooms,
  newMsg,
  sending,
  uploading,
  replyTo,
  pasteFile,
  pastePreviewUrl,
  otherReadAt,
  loadingMsgs,
  onNewMsgChange,
  onSend,
  onSendFile,
  onSetReplyTo,
  onClearPaste,
  onPaste,
  onContextMenu,
  onAddMembers,
  onCreateSubgroup,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const myId = profile?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const downloadFile = async (msg: ChatMessage): Promise<void> => {
    // Re-fetch the message to get a fresh short-lived signed URL.
    try {
      const fresh = await apiGet<ChatMessageDto>(`/chat_messages/${msg.id}/`);
      if (fresh.file_url) window.open(fresh.file_url, "_blank");
    } catch {
      /* signed URL unavailable */
    }
  };

  return (
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
            ? activeRoom.parent_room_id
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
            {activeRoom.parent_room_id && (
              <span
                style={{
                  fontSize: 10,
                  color: "#94a3b8",
                  fontWeight: 400,
                  marginLeft: 6,
                }}
              >
                subgroup of{" "}
                {rooms.find((r) => r.id === activeRoom.parent_room_id)
                  ?.displayName || "group"}
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
                    (id) => (profileMap[id]?.full_name || "").split(" ")[0],
                  )
                  .filter(Boolean)
                  .join(", ")}`
              : "🔒 Private direct message"}
          </div>
        </div>
        {/* Action buttons — only for groups */}
        {activeRoom.type === "group" && (onAddMembers || onCreateSubgroup) && (
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            {onAddMembers && (
              <button
                onClick={onAddMembers}
                title="Add more members to this group"
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
            )}
            {onCreateSubgroup && !activeRoom.parent_room_id && (
              <button
                onClick={onCreateSubgroup}
                title="Create a subgroup inside this group"
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
          <div style={{ color: "#94a3b8", textAlign: "center", padding: 30 }}>
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
              const isMe = msg.sender_id === myId;
              const sender = profileMap[msg.sender_id];
              const senderName = sender?.full_name || "Unknown";
              const prev = messages[idx - 1];
              const sameAuthor = prev?.sender_id === msg.sender_id;
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
                        style={{ flex: 1, height: 1, background: "#e2e8f0" }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          color: "#94a3b8",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(msg.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <div
                        style={{ flex: 1, height: 1, background: "#e2e8f0" }}
                      />
                    </div>
                  )}
                  <div
                    id={`chat-msg-${msg.id}`}
                    onContextMenu={(e) => onContextMenu(e, msg)}
                    style={{
                      display: "flex",
                      flexDirection: isMe ? "row-reverse" : "row",
                      alignItems: "flex-end",
                      gap: 6,
                      marginTop: sameAuthor && !showDate ? 2 : 6,
                      position: "relative",
                      borderRadius: 8,
                      padding: "2px 0",
                      cursor: "context-menu",
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
                            !sameAuthor || showDate ? "visible" : "hidden",
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
                        }}
                      >
                        {/* Quoted reply */}
                        {msg.reply_to_id &&
                          (() => {
                            const orig = messages.find(
                              (m) => m.id === msg.reply_to_id,
                            );
                            const origSender =
                              profileMap[orig?.sender_id ?? ""];
                            const origName =
                              origSender?.full_name || "Unknown";
                            const origText =
                              orig?.message ||
                              (orig?.file_name
                                ? `📎 ${orig.file_name}`
                                : "(deleted)");
                            return (
                              <div
                                style={{
                                  borderLeft: `3px solid ${isMe ? "rgba(255,255,255,.5)" : "#94a3b8"}`,
                                  paddingLeft: 7,
                                  marginBottom: 5,
                                  background: isMe
                                    ? "rgba(255,255,255,.12)"
                                    : "#f1f5f9",
                                  borderRadius: "0 6px 6px 0",
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                }}
                                onClick={() => {
                                  if (!orig) return;
                                  const el = document.getElementById(
                                    `chat-msg-${orig.id}`,
                                  );
                                  if (el) {
                                    el.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    });
                                    el.style.transition = "background .3s";
                                    el.style.background = "#fef9c3";
                                    setTimeout(
                                      () => (el.style.background = ""),
                                      1400,
                                    );
                                  }
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: isMe
                                      ? "rgba(255,255,255,.8)"
                                      : "#2563eb",
                                    marginBottom: 1,
                                  }}
                                >
                                  ↩ {origName}
                                </div>
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    color: isMe
                                      ? "rgba(255,255,255,.7)"
                                      : "#64748b",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    maxWidth: 200,
                                  }}
                                >
                                  {origText}
                                </div>
                              </div>
                            );
                          })()}
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
                            <span style={{ fontSize: 20, flexShrink: 0 }}>
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
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        {fmtFull(msg.created_at)}
                        {isMe &&
                          (activeRoom.type === "direct" ? (
                            otherReadAt && otherReadAt >= msg.created_at ? (
                              <span
                                title="Seen"
                                style={{
                                  color: "#2563eb",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                ✓✓
                              </span>
                            ) : (
                              <span
                                title="Delivered"
                                style={{
                                  color: "#94a3b8",
                                  fontSize: 11,
                                  lineHeight: 1,
                                }}
                              >
                                ✓
                              </span>
                            )
                          ) : (
                            <span
                              title="Sent"
                              style={{
                                color: "#94a3b8",
                                fontSize: 11,
                                lineHeight: 1,
                              }}
                            >
                              ✓
                            </span>
                          ))}
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
                {profileMap[replyTo.sender_id]?.full_name || "Unknown"}
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
              onClick={() => onSetReplyTo(null)}
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
        {/* Paste image preview */}
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
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                {fmtSize(pasteFile.size)} · Pasted image — click ➤ to send
              </div>
            </div>
            <button
              type="button"
              onClick={onClearPaste}
              title="Remove pasted image"
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
          onSubmit={onSend}
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
              if (e.target.files?.[0]) {
                onSendFile(e.target.files[0]);
                e.target.value = "";
              }
            }}
          />
          <input
            ref={inputRef}
            value={newMsg}
            onChange={(e) => onNewMsgChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            onPaste={onPaste}
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
            disabled={(!newMsg.trim() && !pasteFile) || sending || uploading}
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
          Enter to send · Shift+Enter for new line · 📎 attach · Ctrl+V paste
          image · Right-click message to Reply / Forward
        </div>
      </div>
    </div>
  );
}
