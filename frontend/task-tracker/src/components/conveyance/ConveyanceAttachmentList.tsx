import { openAuthenticatedFile } from "@/lib/api";
import type { ConveyanceAttachment } from "@/types/api/conveyance";

interface Props {
  attachments: ConveyanceAttachment[];
  canDelete?: boolean;
  onDelete?: (uid: string) => void;
}

// Plain <a href> downloads fail with 401 because the API requires a JWT
// Authorization header that the browser can't attach on a normal navigation.
// `openAuthenticatedFile` fetches with the bearer token, then opens the
// response as a same-origin blob URL.
async function open(url: string | null) {
  if (!url) return;
  try {
    await openAuthenticatedFile(url);
  } catch {
    /* swallow — link is already disabled for missing files */
  }
}

const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  textDecoration: "underline",
  cursor: "pointer",
  font: "inherit",
};

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
        <button
          type="button"
          onClick={() => void open(a.file_url)}
          disabled={!a.file_url}
          title={a.label || a.filename || ""}
          style={linkStyle}
        >
          📎 {a.label || a.filename}
        </button>
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
            <button
              type="button"
              onClick={() => void open(a.file_url)}
              disabled={!a.file_url}
              style={linkStyle}
            >
              {a.label || a.filename}
            </button>
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
