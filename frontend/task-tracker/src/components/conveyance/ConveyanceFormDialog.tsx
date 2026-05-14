import { useState, useRef, useEffect, useMemo } from "react";

import type { ConveyanceAttachment, ConveyanceEntry } from "@/types/api/conveyance";
import {
  type EntryScope,
  createEntry,
  updateEntry,
  addAttachment,
  deleteAttachment as apiDeleteAttachment,
} from "@/utils/conveyanceApi";

import ConveyanceAttachmentList from "./ConveyanceAttachmentList";
import {
  type FileRow,
  MAX_FILE_BYTES,
  validateFormInputs,
  buildCreateFormData,
} from "./conveyanceFormHelpers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConveyanceFormDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ConveyanceEntry | null;
  /** Clients with their org memberships, used for filtering in create mode.
   *  ``is_active`` (defaulting to true when omitted) lets the create picker
   *  drop deactivated clients while the edit picker keeps the bound one. */
  clients: { uid: string; label: string; orgs: string[]; is_active?: boolean }[];
  /** Orgs the current user is a member of. Dialog shows a selector when length > 1. */
  orgOptions: { uid: string; name: string }[];
  /** Header-selected org uid (seeds the default). Empty string = "All". */
  selectedOrg: string;
  currentUserIsOrgAdminForEntry: boolean;
  /** Scope for the update call when editing a series row. */
  editScope?: EntryScope;
  onSaved: (entry: ConveyanceEntry) => void;
  onDeletedAttachment?: (entryUid: string, attachmentUid: string) => void;
  onAddedAttachment?: (entryUid: string, attachment: ConveyanceAttachment) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);

// YYYY-MM-DD → YYYY-MM (drop day for <input type="month">)
function toMonthInput(date: string | null | undefined): string {
  return (date ?? "").slice(0, 7);
}

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  width: "100%",
  maxWidth: 560,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const fieldStyle: React.CSSProperties = { marginBottom: 14 };

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 14,
  boxSizing: "border-box",
};

const btnStyle = (variant: "primary" | "secondary" | "danger"): React.CSSProperties => ({
  padding: "6px 16px",
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  background: variant === "primary" ? "#2563eb" : variant === "danger" ? "#dc2626" : "#e5e7eb",
  color: variant === "primary" || variant === "danger" ? "#fff" : "#111",
});

export default function ConveyanceFormDialog({
  open,
  onClose,
  entry,
  clients,
  orgOptions,
  selectedOrg,
  currentUserIsOrgAdminForEntry,
  editScope,
  onSaved,
  onDeletedAttachment,
  onAddedAttachment,
}: ConveyanceFormDialogProps) {
  const isCreate = entry === null;
  const canEdit =
    isCreate ||
    entry.status === "pending" ||
    currentUserIsOrgAdminForEntry;

  // ----- Core form fields -----
  const [date, setDate] = useState(entry?.date ?? today);
  const [client, setClient] = useState(entry?.client_detail.uid ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [claimable, setClaimable] = useState(entry?.claimable ?? true);
  const [frequency, setFrequency] = useState<ConveyanceEntry["frequency"]>(
    entry?.frequency ?? "one_time",
  );
  const [startMonth, setStartMonth] = useState(toMonthInput(entry?.start_month));
  const [endMonth, setEndMonth] = useState(toMonthInput(entry?.end_month));

  // Org: create mode only. Default order matches the spec:
  //   1. header selectedOrg (if it's one of the user's memberships)
  //   2. orgOptions[0] (the Page sorts is_default-first, so this is the
  //      user's primary org)
  //   3. "" (force a manual pick — only when orgOptions is empty)
  const defaultOrg =
    (selectedOrg && orgOptions.some((o) => o.uid === selectedOrg)
      ? selectedOrg
      : orgOptions[0]?.uid) ?? "";
  const [org, setOrg] = useState(defaultOrg);

  // In create mode, only show clients that belong to the selected org AND
  // are still active (is_active defaults to true when omitted). In edit
  // mode we leave the full list alone — org is immutable on edit and the
  // bound client (which may now be inactive) must remain selectable so
  // saving doesn't blank out the FK.
  const visibleClients = useMemo(
    () => {
      if (!isCreate) return clients;
      return clients.filter((c) => {
        if (org && !c.orgs.includes(org)) return false;
        return c.is_active !== false;
      });
    },
    [isCreate, org, clients],
  );

  // If the user switches org and the current client isn't in the new org's
  // list, clear it so the backend doesn't reject the submit.
  useEffect(() => {
    if (!isCreate || !client) return;
    if (!visibleClients.some((c) => c.uid === client)) {
      setClient("");
    }
  }, [isCreate, client, visibleClients]);

  // Re-sync when entry changes (e.g. dialog re-opens with a different entry)
  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? today);
    setClient(entry?.client_detail.uid ?? "");
    setReason(entry?.reason ?? "");
    setAmount(entry?.amount ?? "");
    setClaimable(entry?.claimable ?? true);
    setFrequency(entry?.frequency ?? "one_time");
    setStartMonth(toMonthInput(entry?.start_month));
    setEndMonth(toMonthInput(entry?.end_month));
    setNewFiles([]);
    setUploadErrors({});
    setSubmitError(null);
  }, [open, entry]);

  // Seed org only on the closed→open transition. A header org switch
  // mid-edit must not clobber the user's explicit pick, so we track the
  // previous `open` value via a ref instead of suppressing exhaustive-deps.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setOrg(defaultOrg);
    }
    wasOpenRef.current = open;
  }, [open, defaultOrg]);

  // ----- Existing attachments (edit mode) -----
  const [existingAttachments, setExistingAttachments] = useState<ConveyanceAttachment[]>(
    entry?.attachments ?? [],
  );
  useEffect(() => {
    setExistingAttachments(entry?.attachments ?? []);
  }, [entry]);

  // ----- New files to upload -----
  const [newFiles, setNewFiles] = useState<FileRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- Per-file upload errors (edit mode inline upload) -----
  const [uploadErrors, setUploadErrors] = useState<Record<number, string>>({});

  // ----- Submission state -----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!open) return null;

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const { ok: formValid, errors: validationErrors } = validateFormInputs({
    reason,
    amount,
    client,
    // Edit mode: `ConveyanceEntry` doesn't expose org_detail and the org
    // is immutable server-side, so skip the check with a sentinel. This
    // value is never sent — updateEntry only posts the editable fields.
    org: isCreate ? org : "edit-mode",
    files: newFiles,
    frequency,
    start_month: startMonth,
    end_month: endMonth,
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setNewFiles((prev) => [
      ...prev,
      ...picked.map((f) => ({ file: f, label: "" })),
    ]);
    // Reset input so the same file can be added again if needed
    e.target.value = "";
  }

  function removeNewFile(idx: number) {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
    setUploadErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function updateLabel(idx: number, lbl: string) {
    setNewFiles((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, label: lbl } : row)),
    );
  }

  // --- Edit mode: delete an existing attachment ---
  async function handleDeleteExisting(uid: string) {
    if (!entry) return;
    try {
      await apiDeleteAttachment(uid);
      setExistingAttachments((prev) => prev.filter((a) => a.uid !== uid));
      onDeletedAttachment?.(entry.uid, uid);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to delete attachment.");
    }
  }

  // --- Edit mode: upload new files immediately ---
  async function handleUploadNew() {
    if (!entry) return;
    const errors: Record<number, string> = {};
    const uploaded: ConveyanceAttachment[] = [];
    const remaining: FileRow[] = [];

    for (let i = 0; i < newFiles.length; i++) {
      const { file, label } = newFiles[i];
      if (file.size > MAX_FILE_BYTES) {
        errors[i] = "File exceeds 20 MB.";
        remaining.push(newFiles[i]);
        continue;
      }
      try {
        const att = await addAttachment(entry.uid, file, label);
        uploaded.push(att);
        onAddedAttachment?.(entry.uid, att);
      } catch (err: unknown) {
        errors[i] = err instanceof Error ? err.message : "Upload failed.";
        remaining.push(newFiles[i]);
      }
    }

    setExistingAttachments((prev) => [...prev, ...uploaded]);
    setNewFiles(remaining);
    setUploadErrors(errors);
  }

  // --- Submit (create or update core fields) ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isCreate) {
        const form = buildCreateFormData({
          date,
          client,
          reason,
          amount,
          claimable,
          org,
          files: newFiles,
          frequency,
          start_month: startMonth,
          end_month: endMonth,
        });
        const saved = await createEntry(form);
        onSaved(saved);
        onClose();
      } else {
        const saved = await updateEntry(entry.uid, {
          date,
          client,
          reason: reason.trim(),
          amount,
          claimable,
        }, editScope);
        onSaved(saved);
        onClose();
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = isCreate ? "Add Conveyance Entry" : "Edit Conveyance Entry";

  return (
    <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={title}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }}>
          {/* Organisation — create mode only, hidden for single-org users */}
          {isCreate && orgOptions.length > 1 && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-org">Organisation</label>
              <select
                id="cf-org"
                style={inputStyle}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                required
              >
                <option value="">— select organisation —</option>
                {orgOptions.map((o) => (
                  <option key={o.uid} value={o.uid}>{o.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date — only meaningful for one-time entries */}
          {frequency === "one_time" && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-date">Date</label>
              <input
                id="cf-date"
                type="date"
                style={inputStyle}
                value={date}
                max={today}
                disabled={!canEdit}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          )}

          {/* Client */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-client">Client</label>
            <select
              id="cf-client"
              style={inputStyle}
              value={client}
              disabled={!canEdit}
              onChange={(e) => setClient(e.target.value)}
              required
            >
              <option value="">— select client —</option>
              {visibleClients.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.label}{c.is_active === false ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-reason">Reason</label>
            <textarea
              id="cf-reason"
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
              value={reason}
              disabled={!canEdit}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              required
            />
          </div>

          {/* Amount */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-amount">Amount (INR)</label>
            <input
              id="cf-amount"
              type="number"
              step="0.01"
              min="0.01"
              style={inputStyle}
              value={amount}
              disabled={!canEdit}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* Frequency */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-frequency">Frequency</label>
            <select
              id="cf-frequency"
              style={inputStyle}
              value={frequency}
              disabled={!isCreate || !canEdit}
              onChange={(e) => setFrequency(e.target.value as ConveyanceEntry["frequency"])}
            >
              <option value="one_time">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="half_yearly">Half-yearly</option>
              <option value="yearly">Yearly</option>
            </select>
            {!isCreate && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Frequency, start and end months are fixed at creation. Delete the series to change them.
              </div>
            )}
          </div>

          {/* Start month — only for recurring */}
          {frequency !== "one_time" && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-start-month">Start month</label>
              <input
                id="cf-start-month"
                type="month"
                style={inputStyle}
                value={startMonth}
                disabled={!isCreate || !canEdit}
                onChange={(e) => setStartMonth(e.target.value)}
                required
              />
            </div>
          )}

          {/* End month — only for recurring */}
          {frequency !== "one_time" && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-end-month">End month</label>
              <input
                id="cf-end-month"
                type="month"
                style={inputStyle}
                value={endMonth}
                disabled={!isCreate || !canEdit}
                onChange={(e) => setEndMonth(e.target.value)}
                required
              />
            </div>
          )}

          {/* Claimable */}
          <div style={{ ...fieldStyle, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="cf-claimable"
              type="checkbox"
              checked={claimable}
              disabled={!canEdit}
              onChange={(e) => setClaimable(e.target.checked)}
            />
            <label htmlFor="cf-claimable" style={{ fontSize: 14 }}>Claimable</label>
          </div>

          {/* Existing attachments section (edit mode only) */}
          {!isCreate && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Existing Attachments</div>
              <ConveyanceAttachmentList
                attachments={existingAttachments}
                canDelete={canEdit}
                onDelete={(uid) => { void handleDeleteExisting(uid); }}
              />
            </div>
          )}

          {/* New files — always in create; only if editable in edit */}
          {(isCreate || canEdit) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {isCreate ? "Attachments" : "Add More Attachments"}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                style={btnStyle("secondary")}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose files…
              </button>

              {newFiles.length > 0 && (
                <ul style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
                  {newFiles.map((row, idx) => {
                    const tooBig = row.file.size > MAX_FILE_BYTES;
                    return (
                      <li key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, minWidth: 120, color: tooBig ? "crimson" : undefined }}>
                          {row.file.name}
                          {tooBig && " — exceeds 20 MB"}
                        </span>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>
                          ({(row.file.size / 1024).toFixed(0)} KB)
                        </span>
                        <input
                          type="text"
                          placeholder="Label (optional)"
                          value={row.label}
                          onChange={(e) => updateLabel(idx, e.target.value)}
                          style={{ ...inputStyle, width: 160, padding: "3px 6px" }}
                        />
                        <button
                          type="button"
                          onClick={() => removeNewFile(idx)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}
                          aria-label={`Remove ${row.file.name}`}
                        >
                          ✕
                        </button>
                        {uploadErrors[idx] && (
                          <span style={{ color: "crimson", fontSize: 12 }}>{uploadErrors[idx]}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Edit mode: explicit "Upload" button for ad-hoc additions */}
              {!isCreate && newFiles.length > 0 && (
                <button
                  type="button"
                  style={{ ...btnStyle("secondary"), marginTop: 6 }}
                  onClick={() => { void handleUploadNew(); }}
                  disabled={newFiles.some((f) => f.file.size > MAX_FILE_BYTES)}
                >
                  Upload
                </button>
              )}
            </div>
          )}

          {/* Errors */}
          {submitError && (
            <div role="alert" style={{ color: "crimson", fontSize: 13, marginBottom: 10 }}>
              {submitError}
            </div>
          )}
          {!formValid && validationErrors.map((msg, i) => (
            <div key={i} style={{ color: "crimson", fontSize: 12, marginBottom: 4 }}>{msg}</div>
          ))}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" style={btnStyle("secondary")} onClick={onClose}>
              Cancel
            </button>
            {canEdit && (
              <button
                type="submit"
                style={btnStyle("primary")}
                disabled={!formValid || submitting}
              >
                {submitting ? "Saving…" : isCreate ? "Create" : "Save"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
