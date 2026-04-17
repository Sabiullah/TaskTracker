import { useState, useMemo } from "react";
import { ApiError, apiPost } from "@/lib/api";
import ModalWrap from "@/components/ui/ModalWrap";
import { avatarColor, initials } from "@/utils/avatar";
import type { ChatRoom, ChatMessage } from "@/types";
import type {
  ChatMessageCreate,
  ChatMessageDto,
  ChatRoomCreate,
  ChatRoomDto,
} from "@/types/api";

export interface ForwardModalProps {
  forwardMsg: Partial<ChatMessage>;
  rooms: ChatRoom[];
  activeRoom: ChatRoom | null;
  myId: string;
  profiles: unknown[];
  onDone: () => void;
  onClose: () => void;
}

export default function ForwardModal({
  forwardMsg,
  rooms,
  activeRoom,
  myId,
  profiles,
  onDone,
  onClose,
}: ForwardModalProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const allPeople = useMemo(
    () =>
      (profiles || [])
        .filter((p: unknown) => (p as { id: string }).id !== myId)
        .map((p: unknown) => {
          const profile = p as {
            id: string;
            full_name?: string;
            name?: string;
            role?: string;
          };
          const name = profile.full_name || profile.name || "Unknown";
          const existingRoom = rooms.find(
            (r) =>
              r.type === "direct" &&
              r.memberIds?.includes(myId) &&
              r.memberIds?.includes(profile.id),
          );
          return {
            kind: "person" as const,
            id: profile.id,
            name,
            role: profile.role,
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
        .map((r) => {
          const parentName = r.parent_room_id
            ? rooms.find((p) => p.id === r.parent_room_id)?.displayName || ""
            : "";
          return {
            kind: "room" as const,
            id: r.id,
            name: r.displayName || r.name,
            parentName,
            isSubgroup: !!r.parent_room_id,
            room: r,
          };
        })
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

  const handleSend = async (): Promise<void> => {
    if (!selected.length) return;
    setSending(true);
    const fwdText = forwardMsg.message
      ? `↗ Forwarded:\n${forwardMsg.message}`
      : null;

    const sendToRoom = async (roomId: string): Promise<void> => {
      const body: ChatMessageCreate = {
        room: roomId as unknown as number,
        message:
          fwdText ||
          (forwardMsg.file_path ? "↗ Forwarded file" : "↗ Forwarded"),
      };
      await apiPost<ChatMessageDto>("/chat_messages/", body);
    };

    try {
      for (const key of selected) {
        const [kind, id] = key.split(":");
        if (kind === "room") {
          await sendToRoom(id);
        } else {
          const person = allPeople.find((p) => p.id === id);
          let roomId = person?.existingRoomId;
          if (!roomId) {
            const body: ChatRoomCreate = {
              name: "",
              type: "direct",
              member_uids: [myId, id],
            };
            const room = await apiPost<ChatRoomDto>("/chat_rooms/", body);
            roomId = room.uid;
          }
          await sendToRoom(roomId);
        }
      }
      onDone();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Forward failed: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const totalSelected = selected.length;

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
        placeholder="🔍  Search people or groups…"
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

      {totalSelected > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "#2563eb",
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          ✓ {totalSelected} selected
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
          disabled={!totalSelected || sending}
          style={{
            flex: 2,
            padding: "8px 0",
            background: totalSelected ? "#2563eb" : "#cbd5e1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: totalSelected ? "pointer" : "default",
            fontWeight: 700,
            fontSize: 13,
            transition: "background .2s",
          }}
        >
          {sending
            ? "Sending…"
            : `↗ Forward${totalSelected ? ` to ${totalSelected}` : ""}`}
        </button>
      </div>
    </ModalWrap>
  );
}
