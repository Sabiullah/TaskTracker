import { useState } from "react";

interface Props {
  onApprove: () => Promise<void>;
  onReject: (comment: string) => Promise<void>;
}

export default function VisitReviewPanel({ onApprove, onReject }: Props) {
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (showRejectBox) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <textarea
          placeholder="Reason for rejection (required)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={!comment.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try { await onReject(comment.trim()); } finally { setBusy(false); }
            }}
            style={{ padding: "6px 12px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6 }}
          >
            Confirm reject
          </button>
          <button
            type="button"
            onClick={() => { setShowRejectBox(false); setComment(""); }}
            style={{ padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 6 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await onApprove(); } finally { setBusy(false); }
        }}
        style={{ padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        ✓ Approve
      </button>
      <button
        type="button"
        onClick={() => setShowRejectBox(true)}
        style={{ padding: "6px 12px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer" }}
      >
        ✗ Reject…
      </button>
    </div>
  );
}
