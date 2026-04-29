import { useState } from "react";

export interface RejectKaizenModalProps {
  /** Display label for the entry being rejected (used in the modal title). */
  entryLabel: string;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

export default function RejectKaizenModal({
  entryLabel,
  onSubmit,
  onClose,
}: RejectKaizenModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: "min(480px, 92vw)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>
          Reject Kaizen
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#475569" }}>
          {entryLabel}
        </p>
        <label
          htmlFor="kaizen-reject-reason"
          style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}
        >
          Reason <span style={{ color: "#dc2626" }}>*</span>
        </label>
        <textarea
          id="kaizen-reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Why is this entry being rejected? The raiser will see this."
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: 8,
            border: "1px solid #cbd5e1",
            borderRadius: 5,
            fontSize: 13,
            resize: "vertical",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              background: "#fff",
              color: "#334155",
              border: "1px solid #cbd5e1",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            style={{
              padding: "6px 12px",
              background: canSubmit ? "#dc2626" : "#fca5a5",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {submitting ? "…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
