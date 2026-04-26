import { useState, type CSSProperties } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const sheet: CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 16,
  width: 380,
  maxWidth: "90vw",
};

const textarea: CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const btnRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 12,
};

const btnSecondary: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const btnDanger: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  background: "#dc2626",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

export default function RejectModal({ open, title, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await onSubmit(reason.trim());
      setReason("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h3>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason for rejection (required)"
          style={textarea}
          disabled={busy}
          autoFocus
        />
        <div style={btnRow}>
          <button onClick={onClose} disabled={busy} style={btnSecondary}>
            Cancel
          </button>
          <button
            disabled={busy || !reason.trim()}
            onClick={() => {
              void submit();
            }}
            style={btnDanger}
          >
            {busy ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
