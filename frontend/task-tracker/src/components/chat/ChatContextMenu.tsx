import type { ChatMessage } from "@/types";

interface ContextMenuState {
  x: number;
  y: number;
  msg: ChatMessage;
}

export interface ChatContextMenuProps {
  contextMenu: ContextMenuState;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
}

export default function ChatContextMenu({
  contextMenu,
  onClose,
  onReply,
  onForward,
}: ChatContextMenuProps) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 19998 }}
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        style={{
          position: "fixed",
          top: Math.min(contextMenu.y, window.innerHeight - 110),
          left: Math.min(contextMenu.x, window.innerWidth - 160),
          zIndex: 19999,
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          minWidth: 150,
        }}
      >
        <div
          style={{
            padding: "8px 14px 6px",
            borderBottom: "1px solid #f1f5f9",
            fontSize: 10,
            color: "#94a3b8",
            maxWidth: 150,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {contextMenu.msg.message ||
            (contextMenu.msg.file_name
              ? `📎 ${contextMenu.msg.file_name}`
              : "")}
        </div>
        <div
          onClick={onReply}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#1e293b",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLDivElement).style.background = "#eff6ff")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLDivElement).style.background =
              "transparent")
          }
        >
          <span style={{ fontSize: 16 }}>↩</span>
          Reply
        </div>
        <div
          onClick={onForward}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#1e293b",
            borderTop: "1px solid #f1f5f9",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLDivElement).style.background = "#f0fdf4")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLDivElement).style.background =
              "transparent")
          }
        >
          <span style={{ fontSize: 16 }}>↗</span>
          Forward
        </div>
      </div>
    </>
  );
}
