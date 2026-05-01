import { useState } from "react";

import type { EntryScope } from "@/utils/conveyanceApi";

export type ScopeAction = "edit" | "delete";

interface Props {
  open: boolean;
  action: ScopeAction;
  onCancel: () => void;
  onConfirm: (scope: EntryScope) => void;
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

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  background: "#2563eb",
  color: "#fff",
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: "#e5e7eb",
  color: "#111",
};

export default function ConveyanceScopeDialog({ open, action, onCancel, onConfirm }: Props) {
  const [scope, setScope] = useState<EntryScope>("row");
  if (!open) return null;

  const verb = action === "edit" ? "Edit" : "Delete";
  return (
    <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={`${verb} scope`}>
      <div style={panelStyle}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16 }}>
          {verb} recurring entry
        </h3>
        <p style={{ margin: 0, marginBottom: 16, fontSize: 13, color: "#374151" }}>
          This entry is part of a recurring series. Apply the {verb.toLowerCase()} to:
        </p>

        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "row"}
            onChange={() => setScope("row")}
          />
          This entry only
        </label>
        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "series"}
            onChange={() => setScope("series")}
          />
          Entire series
        </label>
        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "series_forward"}
            onChange={() => setScope("series_forward")}
          />
          Entire series from this month
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" style={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={btnPrimary} onClick={() => onConfirm(scope)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
