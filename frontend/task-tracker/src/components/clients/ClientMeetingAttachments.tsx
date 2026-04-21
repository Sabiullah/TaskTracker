import { useRef, useState } from "react";
import { openAuthenticatedFile } from "@/lib/api";
import type { ClientMeetingAttachmentDto } from "@/types/api/clients";

interface Props {
  attachments: readonly ClientMeetingAttachmentDto[];
  canWrite: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete: (attachmentUid: string) => Promise<void>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientMeetingAttachments({ attachments, canWrite, onUpload, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    setUploading(true);
    try {
      await onUpload(f);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: 8 }}>
          <input ref={fileRef} type="file" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
          {uploading && <span style={{ marginLeft: 8, color: "#64748b" }}>Uploading…</span>}
        </div>
      )}
      {attachments.length === 0 ? (
        <div style={{ color: "#64748b", fontSize: 13 }}>No attachments.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {attachments.map((a) => (
            <li
              key={a.uid}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 13 }}
            >
              <button
                type="button"
                onClick={() => void openAuthenticatedFile(a.download_url)}
                style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
              >
                📎 {a.filename}
              </button>
              <span style={{ color: "#94a3b8" }}>{formatSize(a.size_bytes)}</span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${a.filename}?`)) void onDelete(a.uid);
                  }}
                  style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer" }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
