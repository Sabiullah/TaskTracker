import { useState, useRef } from "react";
import {
  ApiError,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  openAuthenticatedFile,
} from "@/lib/api";
import { fmtDate, formatMonthLabel as fmtMonth } from "@/utils/date";
import { fmtMoney } from "@/utils/money";
import { isOverdue, STATUS_CFG } from "@/utils/invoice";
import type { InvoiceEntry, InvoicePlan } from "@/types";
import type {
  InvoiceEntryDto,
  InvoiceEntryUpdate,
  InvoiceRejectRequest,
} from "@/types/api";

export interface InvoiceActionModalProps {
  entry: InvoiceEntry & {
    notes?: string;
    rejection_reason?: string;
    uploaded_by?: string;
    uploaded_at?: string;
    approved_by?: string;
    approved_at?: string;
  };
  plan: InvoicePlan | null;
  group: InvoiceEntry[] | null;
  planMap: Record<string, InvoicePlan & { job_description?: string }> | null;
  isAdmin: boolean;
  profile: { id: string } | null;
  onClose: () => void;
  onRefresh: () => void;
}

export default function InvoiceActionModal({
  entry,
  plan,
  group,
  planMap,
  isAdmin,
  profile,
  onClose,
  onRefresh,
}: InvoiceActionModalProps) {
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejReason, setRejReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [notes, setNotes] = useState(entry?.notes || "");
  const existingInvNum =
    entry?.invoice_number ||
    (group || []).find((e) => e.invoice_number)?.invoice_number ||
    "";
  const [invNum, setInvNum] = useState(existingInvNum);
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const [saveDone, setSaveDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const overdue = isOverdue(entry);
  const st = STATUS_CFG[entry.status as keyof typeof STATUS_CFG] ?? STATUS_CFG.Pending;

  void profile;

  const handleUpload = async (file: File): Promise<void> => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("invoice_number", invNum || "");
      fd.append("notes", notes || "");
      const dto = await apiPostForm<InvoiceEntryDto>(
        `/invoice_entries/${entry.id}/upload/`,
        fd,
      );
      // The server returns the updated entry, including the short
      // auth-gated ``file_url`` (``/api/invoice_entries/<uid>/download/``).
      // Surface it locally so the "View / Download" link lights up
      // immediately without waiting for the next refresh.
      setUploadedFile({ name: file.name, path: dto.file_url || "" });
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiPost<InvoiceEntryDto>(
        `/invoice_entries/${entry.id}/approve/`,
        {},
      );
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Approve failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (): Promise<void> => {
    if (!rejReason.trim()) {
      alert("Enter rejection reason");
      return;
    }
    setSaving(true);
    try {
      const body: InvoiceRejectRequest = { reason: rejReason.trim() };
      await apiPost<InvoiceEntryDto>(
        `/invoice_entries/${entry.id}/reject/`,
        body,
      );
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Reject failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (): Promise<void> => {
    // ``file_url`` is a persistent auth-gated endpoint. A plain
    // ``window.open`` would 401 because a fresh tab has no JWT — fetch
    // with the auth header, stream into a blob URL, and open THAT.
    try {
      const fresh = await apiGet<InvoiceEntryDto>(
        `/invoice_entries/${entry.id}/`,
      );
      if (fresh.file_url) await openAuthenticatedFile(fresh.file_url);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Download failed: ${msg}`);
    }
  };

  const saveNotes = async (): Promise<void> => {
    setSaving(true);
    try {
      const ids = (group && group.length > 0 ? group : [entry]).map(
        (e) => e.id,
      );
      const body: InvoiceEntryUpdate = {
        invoice_number: invNum || undefined,
        notes: notes || undefined,
      };
      await Promise.all(
        ids.map((id) =>
          apiPatch<InvoiceEntryDto>(`/invoice_entries/${id}/`, body),
        ),
      );
      setSaveDone(true);
      setTimeout(() => onRefresh(), 600);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 500,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            🧾 Invoice —{" "}
            {fmtMonth(
              (entry as { invoice_month?: string }).invoice_month || "",
            )}
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
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "#f8fafc",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
          }}
        >
          {(
            [
              ["Client", (entry as { client_name?: string }).client_name],
              [
                "Invoice Date",
                fmtDate(
                  (entry as { invoice_date?: string }).invoice_date || "",
                ) + (overdue ? " ⚠️ OVERDUE" : ""),
              ],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div
              key={k}
              style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 13 }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: "#64748b",
                  width: 95,
                  flexShrink: 0,
                }}
              >
                {k}:
              </span>
              <span
                style={{
                  color:
                    k === "Invoice Date" && overdue ? "#dc2626" : "#1e293b",
                  fontWeight: k === "Invoice Date" && overdue ? 700 : 400,
                }}
              >
                {v || "—"}
              </span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 2,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: "#64748b",
                fontSize: 13,
                width: 95,
                flexShrink: 0,
              }}
            >
              Status:
            </span>
            <span
              style={{
                background: st.bg,
                color: st.color,
                padding: "2px 9px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {st.icon} {entry.status}
            </span>
          </div>

          <div style={{ borderTop: "1.5px solid #e2e8f0", paddingTop: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Job-wise Breakdown
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ background: "#e2e8f0" }}>
                  <th
                    style={{
                      padding: "5px 8px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#475569",
                      borderRadius: "4px 0 0 4px",
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      padding: "5px 8px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#475569",
                    }}
                  >
                    Job Description
                  </th>
                  <th
                    style={{
                      padding: "5px 8px",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#475569",
                      borderRadius: "0 4px 4px 0",
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {(group && group.length > 0 ? group : [entry]).map((e, i) => {
                  const jobDesc =
                    planMap?.[e.plan_id]?.job_description ||
                    plan?.job_description ||
                    "—";
                  return (
                    <tr
                      key={e.id}
                      style={{ borderBottom: "1px solid #f1f5f9" }}
                    >
                      <td style={{ padding: "6px 8px", color: "#94a3b8" }}>
                        {i + 1}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#1e293b" }}>
                        {jobDesc}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: "#16a34a",
                        }}
                      >
                        {fmtMoney((e as { amount?: number }).amount ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr
                  style={{
                    background: "#f0fdf4",
                    borderTop: "2px solid #bbf7d0",
                  }}
                >
                  <td
                    colSpan={2}
                    style={{
                      padding: "7px 8px",
                      fontWeight: 800,
                      color: "#15803d",
                      fontSize: 13,
                    }}
                  >
                    Total
                  </td>
                  <td
                    style={{
                      padding: "7px 8px",
                      textAlign: "right",
                      fontWeight: 800,
                      color: "#15803d",
                      fontSize: 13,
                    }}
                  >
                    {fmtMoney(
                      (group && group.length > 0 ? group : [entry]).reduce(
                        (s, e) =>
                          s + Number((e as { amount?: number }).amount || 0),
                        0,
                      ),
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                display: "block",
                marginBottom: 3,
              }}
            >
              Invoice Number
            </label>
            <input
              value={invNum}
              onChange={(e) => setInvNum(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 5,
                fontSize: 12,
                boxSizing: "border-box",
              }}
              placeholder="INV-001"
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={saveNotes}
              disabled={saving || saveDone}
              style={{
                padding: "6px 14px",
                border: `1px solid ${uploadedFile ? "#16a34a" : "#e2e8f0"}`,
                borderRadius: 5,
                cursor: saving || saveDone ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                width: "100%",
                background: saveDone
                  ? "#f0fdf4"
                  : uploadedFile
                    ? "#16a34a"
                    : "#f8fafc",
                color: saveDone ? "#16a34a" : uploadedFile ? "#fff" : "#374151",
              }}
            >
              {saveDone ? "✅ Saved!" : saving ? "Saving…" : "💾 Save Details"}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              display: "block",
              marginBottom: 3,
            }}
          >
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 5,
              fontSize: 12,
              boxSizing: "border-box",
              resize: "vertical",
            }}
            placeholder="Any notes..."
          />
        </div>

        {(() => {
          // Prefer the row's server-provided file_url as the "has file"
          // signal. ``uploadedFile`` is just the local optimistic state
          // right after a fresh upload — both show the panel, but the
          // download/re-upload buttons always key off the persisted URL.
          const hasFile =
            Boolean(uploadedFile) || Boolean(entry.file_url) ||
            Boolean(entry.file_name);
          if (!hasFile) return null;
          // Server stores files under hashed UUID names (invoice-uid.pdf),
          // which are noise to the user. Show a short "Invoice.<ext>"
          // label in the pill and keep the real filename as a hover
          // tooltip for reference.
          const rawName =
            uploadedFile?.name || entry.file_name || "Invoice file";
          const dot = rawName.lastIndexOf(".");
          const ext = dot > -1 ? rawName.slice(dot + 1).toLowerCase() : "";
          const label = ext ? `Invoice.${ext}` : "Invoice file";
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                padding: "8px 12px",
                background: uploadedFile ? "#f0fdf4" : "#eff6ff",
                borderRadius: 7,
                border: `1px solid ${uploadedFile ? "#bbf7d0" : "#bfdbfe"}`,
              }}
            >
              <span
                title={rawName}
                style={{
                  fontSize: 12,
                  color: "#1e293b",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {uploadedFile ? "✅ " : "📎 "}
                {label}
              </span>
              {entry.file_url && (
                <button
                  onClick={handleDownload}
                  style={{
                    padding: "4px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  ⬇ Download
                </button>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: "4px 10px",
                  background: "#f59e0b",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                🔄 Re-upload
              </button>
            </div>
          );
        })()}

        <input
          type="file"
          ref={fileRef}
          style={{ display: "none" }}
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) =>
            e.target.files?.[0] && handleUpload(e.target.files[0])
          }
        />

        {["Pending", "Rejected"].includes(entry.status) &&
          !uploadedFile &&
          !entry.file_url &&
          !entry.file_name && (
            <div style={{ marginBottom: 14 }}>
              {(entry as { rejection_reason?: string }).rejection_reason && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    padding: "6px 10px",
                    marginBottom: 8,
                    fontSize: 12,
                    color: "#dc2626",
                  }}
                >
                  ❌ Rejected:{" "}
                  {(entry as { rejection_reason?: string }).rejection_reason}
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: "8px 18px",
                  background: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  width: "100%",
                  opacity: uploading ? 0.8 : 1,
                }}
              >
                {uploading ? "Uploading…" : "📤 Upload Invoice (PDF/Image)"}
              </button>
            </div>
          )}

        {uploading && (
          <div
            style={{
              textAlign: "center",
              padding: "8px 0",
              fontSize: 12,
              color: "#64748b",
              marginBottom: 8,
            }}
          >
            ⏳ Uploading, please wait…
          </div>
        )}

        {uploadedFile && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 7,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 12,
              color: "#92400e",
            }}
          >
            ⚠️ Enter the <strong>Invoice Number</strong> above and click{" "}
            <strong>Save Details</strong> to complete.
          </div>
        )}

        {isAdmin && entry.status === "Uploaded" && !showReject && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleApprove}
              disabled={saving}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              ✅ Approve Invoice
            </button>
            <button
              onClick={() => setShowReject(true)}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              ❌ Reject
            </button>
          </div>
        )}
        {isAdmin && showReject && (
          <div>
            <textarea
              value={rejReason}
              onChange={(e) => setRejReason(e.target.value)}
              rows={2}
              placeholder="Reason for rejection…"
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1.5px solid #fecaca",
                borderRadius: 6,
                fontSize: 13,
                boxSizing: "border-box",
                marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowReject(false)}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
