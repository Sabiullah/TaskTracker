import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  title: string;             // "Description" | "Progress notes"
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}

export default function ClientRoadmapFocusModal({ open, title, initialValue, onClose, onSave }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, .4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: 600,
          maxWidth: "94vw",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={12}
          autoFocus
          style={{ padding: 10, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "8px 14px", background: "#f1f5f9", color: "#1e293b", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
