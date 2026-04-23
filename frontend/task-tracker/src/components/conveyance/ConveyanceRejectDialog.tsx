import { useState, useEffect } from "react";

import type { ConveyanceEntry } from "@/types/api/conveyance";
import { rejectEntry } from "@/utils/conveyanceApi";

export interface ConveyanceRejectDialogProps {
  open: boolean;
  onClose: () => void;
  entryUid: string;
  onRejected: (entry: ConveyanceEntry) => void;
}

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

export default function ConveyanceRejectDialog({
  open,
  onClose,
  entryUid,
  onRejected,
}: ConveyanceRejectDialogProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the dialog opens
  useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = note.trim().length >= 3 && !submitting;

  async function handleReject() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await rejectEntry(entryUid, note.trim());
      onRejected(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rejection failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={dialogStyle} role="dialog" aria-modal="true" aria-label="Reject Entry">
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Reject Entry</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <label htmlFor="reject-note" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Rejection note
        </label>
        <textarea
          id="reject-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            padding: "6px 8px",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            fontSize: 14,
            resize: "vertical",
            boxSizing: "border-box",
          }}
          placeholder="Provide a reason for rejection (min 3 characters)…"
        />

        {error && (
          <div role="alert" style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "6px 16px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 14, background: "#e5e7eb", color: "#111" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleReject(); }}
            disabled={!canSubmit}
            style={{
              padding: "6px 16px",
              borderRadius: 4,
              border: "none",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 14,
              background: "#dc2626",
              color: "#fff",
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {submitting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
