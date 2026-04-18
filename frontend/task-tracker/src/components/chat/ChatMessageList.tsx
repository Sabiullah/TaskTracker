import React, { useRef, useEffect } from "react";
import { apiGet, openAuthenticatedFile } from "@/lib/api";
import type { ChatMessageDto } from "@/types/api";
import { fmtFull } from "@/utils/date";
import { fmtSize, isImage } from "@/utils/chat";
import { avatarColor, initials } from "@/utils/avatar";
import type { Profile, ChatMessage, ChatRoom } from "@/types";

export interface ChatMessageListProps {
  messages: ChatMessage[];
  activeRoom: ChatRoom;
  profile: Profile | null;
  profileMap: Record<string, Profile>;
  otherReadAt: string | null;
  loadingMsgs: boolean;
}

export default function ChatMessageList({
  messages,
  activeRoom,
  profile,
  profileMap,
  otherReadAt,
  loadingMsgs,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const myId = profile?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const downloadFile = async (msg: ChatMessage): Promise<void> => {
    try {
      const fresh = await apiGet<ChatMessageDto>(`/chat_messages/${msg.id}/`);
      if (fresh.file_url) await openAuthenticatedFile(fresh.file_url);
    } catch {
      /* file unavailable — swallow so a broken attachment doesn't crash
         the message list */
    }
  };

  return (
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
        <div style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>
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
                      gap: 10,
                      margin: "10px 0 6px",
                    }}
                  >
                    <div
                      style={{ flex: 1, height: 1, background: "#e2e8f0" }}
                    />
                    <span
                      style={{
                        fontSize: 11,
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
                    {!isMe && !sameAuthor && (
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
                            {isImage(msg.file_type) ? "🖼" : "📄"}
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
                                fontSize: 12,
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
                                fontSize: 12,
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
                              fontSize: 12,
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
  );
}
