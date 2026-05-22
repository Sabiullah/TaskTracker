import { useState } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
} from "@/types/api";

export interface DailyStandupAddModalProps {
  date: string;
  profiles: { uid: string; full_name: string }[];
  onSubmit: (payload: OperationalStandupCreate) => Promise<void>;
  onClose: () => void;
  isAdmin?: boolean;
}

export function DailyStandupAddModal({
  date,
  profiles,
  onSubmit,
  onClose,
  isAdmin = false,
}: DailyStandupAddModalProps) {
  const [profile, setProfile] = useState("");
  const [d, setD] = useState(date);
  const [bt, setBt] = useState<BreakthroughTypeValue>("");
  const [priorities, setPriorities] = useState("");
  const [collab, setCollab] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const minDate = isAdmin ? undefined : date;

  const handleSave = async () => {
    if (!profile || !d) return;
    if (minDate && d < minDate) {
      alert("You can only select today or a future date.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        profile,
        standup_date: d,
        breakthrough_type: bt,
        priorities,
        collaboration_need: collab,
        remarks,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: 540,
          maxWidth: "94vw",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>
          ➕ Add Daily Standup
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Employee</div>
            <select
              aria-label="employee"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            >
              <option value="">— select —</option>
              {profiles.map((p) => (
                <option key={p.uid} value={p.uid}>{p.full_name}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Date</div>
            <input
              type="date"
              value={d}
              min={minDate}
              onChange={(e) => setD(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Breakdown / Breakthrough</div>
            <select
              value={bt}
              onChange={(e) => setBt(e.target.value as BreakthroughTypeValue)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            >
              <option value="">—</option>
              <option value="Breakdown">Breakdown</option>
              <option value="Breakthrough">Breakthrough</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Priorities</div>
            <textarea
              aria-label="priorities"
              value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13, minHeight: 80 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Collaboration need</div>
            <input
              value={collab}
              onChange={(e) => setCollab(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Remarks</div>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 6 }}>
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !profile}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
