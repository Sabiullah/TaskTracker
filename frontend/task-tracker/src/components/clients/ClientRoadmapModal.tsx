import { useEffect, useState } from "react";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";
import type { ClientRoadmapWrite, Priority } from "@/types/api/clients";

interface Props {
  open: boolean;
  /** Pre-fill the client dropdown with this uid. Empty string = no default. */
  defaultClientUid?: string;
  clients: readonly MasterItem[];
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientRoadmapWrite) => Promise<void>;
}

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientRoadmapModal({
  open,
  defaultClientUid,
  clients,
  profiles,
  onClose,
  onSubmit,
}: Props) {
  const [clientUid, setClientUid] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUid, setOwnerUid] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [completionDate, setCompletionDate] = useState<string>("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [category, setCategory] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Always start blank on open — modal is CREATE-only now.
    setClientUid(defaultClientUid ?? "");
    setTitle("");
    setDescription("");
    setOwnerUid("");
    setStartDate("");
    setTargetDate("");
    setExpectedDate("");
    setCompletionDate("");
    setPriority("Medium");
    setCategory("");
    setProgressNotes("");
  }, [open, defaultClientUid]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientUid) return;
    setSaving(true);
    try {
      await onSubmit({
        client: clientUid,
        title: title.trim(),
        description,
        owner: ownerUid || null,
        start_date: startDate || null,
        target_date: targetDate || null,
        expected_date: expectedDate || null,
        completion_date: completionDate || null,
        priority,
        category,
        progress_notes: progressNotes,
      });
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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: 520,
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>Add roadmap item</h3>

        <label style={labelStyle}>Client*</label>
        <select
          value={clientUid}
          onChange={(e) => setClientUid(e.target.value)}
          required
          style={inputStyle}
        >
          <option value="">— Select a client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Title*</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />

        <label style={labelStyle}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inputStyle} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Owner</label>
            <select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} style={inputStyle}>
              <option value="">— Unassigned —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Target date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Expected date</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Completion date</label>
            <input
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} style={inputStyle}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Progress notes</label>
        <textarea value={progressNotes} onChange={(e) => setProgressNotes(e.target.value)} rows={2} style={inputStyle} />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim() || !clientUid} style={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#475569" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  color: "#1e293b",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
};
