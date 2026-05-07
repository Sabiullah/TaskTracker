import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  deleteLeadAttachment,
  listLeadAttachments,
  openAuthenticatedFile,
  uploadLeadAttachment,
} from "@/lib/api";
import type { Lead, LeadAttachment } from "@/types";
import type { LeadAttachmentDto } from "@/types/api/lead";

export interface LeadAttachmentsModalProps {
  lead: Lead;
  /** Authenticated user can upload/delete (admin/manager/owner/assignee). */
  canMutate: boolean;
  onClose: () => void;
  /** Called after a successful upload/delete so the parent can refresh leads. */
  onChanged?: () => void;
}

interface QueueItem {
  /** Stable client-side id so React can key the row across re-renders. */
  id: string;
  file: File;
  /** User-entered display name. Defaults to the filename minus extension. */
  label: string;
  status: "pending" | "uploading" | "error";
  error?: string;
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dtoToAttachment(dto: LeadAttachmentDto): LeadAttachment {
  return {
    uid: dto.uid,
    label: dto.label,
    filename: dto.filename,
    file_url: dto.file_url,
    download_url: dto.download_url,
    size_bytes: dto.size_bytes,
    uploaded_at: dto.uploaded_at,
    uploaded_by_name: dto.uploaded_by_detail?.full_name ?? null,
  };
}

export default function LeadAttachmentsModal({
  lead,
  canMutate,
  onClose,
  onChanged,
}: LeadAttachmentsModalProps) {
  const [existing, setExisting] = useState<LeadAttachment[]>(
    lead.attachments ?? [],
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh once on open so we don't show a stale list if the parent's
  // ``lead.attachments`` is behind a websocket update.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dtos = await listLeadAttachments(lead.id);
        if (!cancelled) setExisting(dtos.map(dtoToAttachment));
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof ApiError ? err.message : String(err);
          setLoadError(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  const allLabelsValid = useMemo(
    () => queue.every((q) => q.label.trim().length > 0),
    [queue],
  );

  const onFilesPicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const items: QueueItem[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
      file: f,
      label: stripExt(f.name),
      status: "pending",
    }));
    setQueue((q) => [...q, ...items]);
    // Reset the input so the same file can be re-selected if the user
    // removed it from the queue.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateLabel = (id: string, label: string) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, label } : it)));
  };

  const removeFromQueue = (id: string) => {
    setQueue((q) => q.filter((it) => it.id !== id));
  };

  const handleUploadAll = async () => {
    if (queue.length === 0 || !allLabelsValid) return;
    setBusy(true);
    let workQueue = [...queue];
    for (const item of [...workQueue]) {
      // Mark as uploading.
      workQueue = workQueue.map((it) =>
        it.id === item.id ? { ...it, status: "uploading" as const, error: undefined } : it,
      );
      setQueue(workQueue);
      try {
        const dto = await uploadLeadAttachment(
          lead.id,
          item.file,
          item.label.trim(),
        );
        // Append to existing list.
        setExisting((prev) => [dtoToAttachment(dto), ...prev]);
        // Drop from queue.
        workQueue = workQueue.filter((it) => it.id !== item.id);
        setQueue(workQueue);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        workQueue = workQueue.map((it) =>
          it.id === item.id
            ? { ...it, status: "error" as const, error: msg }
            : it,
        );
        setQueue(workQueue);
      }
    }
    setBusy(false);
    if (onChanged) onChanged();
  };

  const handleOpen = (a: LeadAttachment) => {
    if (!a.download_url) return;
    void openAuthenticatedFile(a.download_url);
  };

  const handleDelete = async (a: LeadAttachment) => {
    if (!window.confirm(`Delete "${a.label}"? This cannot be undone.`)) return;
    try {
      await deleteLeadAttachment(a.uid);
      setExisting((prev) => prev.filter((x) => x.uid !== a.uid));
      if (onChanged) onChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%",
    padding: "6px 9px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 22,
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>
            📎 Attachments — {lead.client || "(no name)"}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Upload section */}
        {canMutate && (
          <div
            style={{
              border: "1.5px dashed #cbd5e1",
              borderRadius: 8,
              padding: 14,
              marginBottom: 18,
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                marginBottom: 8,
              }}
            >
              Add files
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={onFilesPicked}
              style={{ fontSize: 12 }}
            />
            {queue.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#64748b",
                    marginBottom: 6,
                  }}
                >
                  Enter a display name for each file before uploading.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {queue.map((q) => (
                    <div
                      key={q.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <div
                        title={q.file.name}
                        style={{
                          fontSize: 12,
                          color: "#475569",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {q.file.name}{" "}
                        <span style={{ color: "#94a3b8" }}>
                          ({fmtSize(q.file.size)})
                        </span>
                      </div>
                      <input
                        style={{
                          ...inp,
                          borderColor: q.label.trim()
                            ? "#e2e8f0"
                            : "#f59e0b",
                        }}
                        value={q.label}
                        onChange={(e) => updateLabel(q.id, e.target.value)}
                        placeholder="Display name *"
                        disabled={q.status === "uploading"}
                      />
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {q.status === "uploading" && (
                          <span style={{ fontSize: 11, color: "#2563eb" }}>
                            Uploading…
                          </span>
                        )}
                        {q.status === "error" && (
                          <span
                            style={{ fontSize: 11, color: "#dc2626" }}
                            title={q.error}
                          >
                            Failed
                          </span>
                        )}
                        <button
                          onClick={() => removeFromQueue(q.id)}
                          disabled={q.status === "uploading"}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "#64748b",
                            fontSize: 14,
                          }}
                          aria-label={`Remove ${q.file.name} from queue`}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    onClick={() => void handleUploadAll()}
                    disabled={busy || queue.length === 0 || !allLabelsValid}
                    style={{
                      padding: "7px 16px",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor:
                        busy || !allLabelsValid ? "not-allowed" : "pointer",
                      fontWeight: 700,
                      fontSize: 12,
                      opacity: busy || !allLabelsValid ? 0.7 : 1,
                    }}
                  >
                    {busy
                      ? "Uploading…"
                      : `Upload ${queue.length} file${queue.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Existing attachments */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 8 }}>
          Existing files ({existing.length})
        </div>
        {loadError ? (
          <div style={{ fontSize: 12, color: "#dc2626" }}>
            Could not load attachments: {loadError}
          </div>
        ) : existing.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "#94a3b8",
              padding: "12px 0",
            }}
          >
            No attachments yet.
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {existing.map((a) => (
              <li
                key={a.uid}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "#fff",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleOpen(a)}
                    disabled={!a.download_url}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "#2563eb",
                      textDecoration: "underline",
                      cursor: a.download_url ? "pointer" : "not-allowed",
                      font: "inherit",
                      fontWeight: 600,
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={a.label}
                  >
                    📎 {a.label}
                  </button>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.filename} · {fmtSize(a.size_bytes)}
                    {a.uploaded_by_name ? ` · by ${a.uploaded_by_name}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {a.uploaded_at?.slice(0, 10) ?? ""}
                </div>
                {canMutate ? (
                  <button
                    onClick={() => void handleDelete(a)}
                    title={`Delete ${a.label}`}
                    style={{
                      border: "1px solid #fecaca",
                      background: "#fff1f2",
                      borderRadius: 5,
                      padding: "3px 8px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                    aria-label={`Delete ${a.label}`}
                  >
                    🗑
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 18px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              background: "#f8fafc",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
