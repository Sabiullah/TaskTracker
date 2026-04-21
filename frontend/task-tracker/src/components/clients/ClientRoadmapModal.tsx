import { useEffect, useState } from "react";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  open: boolean;
  clientUid: string;
  existing: ClientRoadmapDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientRoadmapWrite) => Promise<void>;
}

const STATUSES: RoadmapStatus[] = [
  "Not Started",
  "In Progress",
  "Achieved",
  "At Risk",
  "Cancelled",
];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientRoadmapModal({
  open,
  clientUid,
  existing,
  profiles,
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUid, setOwnerUid] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [completionDate, setCompletionDate] = useState<string>("");
  const [status, setStatus] = useState<RoadmapStatus>("Not Started");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [category, setCategory] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? "");
    setDescription(existing?.description ?? "");
    setOwnerUid(existing?.owner ?? "");
    setTargetDate(existing?.target_date ?? "");
    setCompletionDate(existing?.completion_date ?? "");
    setStatus(existing?.status ?? "Not Started");
    setPriority(existing?.priority ?? "Medium");
    setCategory(existing?.category ?? "");
    setProgressNotes(existing?.progress_notes ?? "");
  }, [open, existing]);

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
        target_date: targetDate || null,
        completion_date: completionDate || null,
        status,
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
        <h3 style={{ margin: 0 }}>{existing ? "Edit roadmap item" : "Add roadmap item"}</h3>

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
            <label style={labelStyle}>Target date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={inputStyle} />
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
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as RoadmapStatus)} style={inputStyle}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
