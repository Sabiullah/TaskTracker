import type { ConveyanceAttachment } from "@/types/api/conveyance";

interface Props {
  attachments: ConveyanceAttachment[];
  canDelete?: boolean;
  onDelete?: (uid: string) => void;
}

export default function ConveyanceAttachmentList({
  attachments,
  canDelete = false,
  onDelete,
}: Props) {
  if (attachments.length === 0) return <span className="text-gray-400">—</span>;
  if (attachments.length === 1) {
    const a = attachments[0];
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <a
          href={a.file_url ?? "#"}
          target="_blank"
          rel="noreferrer"
          title={a.label || a.filename || ""}
        >
          📎 {a.label || a.filename}
        </a>
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(a.uid)}
            aria-label={`Delete ${a.label || a.filename}`}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7280" }}
          >
            ✕
          </button>
        )}
      </span>
    );
  }
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>📎 {attachments.length}</summary>
      <ul className="mt-1 text-sm" style={{ listStyle: "none", paddingLeft: 0 }}>
        {attachments.map((a) => (
          <li
            key={a.uid}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <a href={a.file_url ?? "#"} target="_blank" rel="noreferrer">
              {a.label || a.filename}
            </a>
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(a.uid)}
                aria-label={`Delete ${a.label || a.filename}`}
                style={{ border: "none", background: "transparent", cursor: "pointer" }}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
