import { useState, useEffect } from "react";
import { LEAD_SOURCES, PRIORITIES } from "@/utils/leads";
import type { Lead, LeadStatusRecord } from "@/types";

export interface LeadModalProps {
  lead?: Partial<Lead> | null;
  statuses: LeadStatusRecord[];
  memberOptions: string[];
  onSave: (form: Partial<Lead>) => Promise<void>;
  onClose: () => void;
}

const BLANK: Partial<Lead> = {
  client: "",
  contact_person: "",
  contact_email: "",
  contact_phone: "",
  lead_source: "",
  reference_from: "",
  status: "",
  priority: "Medium",
  assigned_to: "",
  estimated_value: undefined,
  action_taken: "",
  next_step: "",
  next_step_date: "",
  remarks: "",
};

export default function LeadModal({
  lead,
  statuses,
  memberOptions,
  onSave,
  onClose,
}: LeadModalProps) {
  const [form, setForm] = useState<Record<string, unknown>>({
    ...BLANK,
    ...lead,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.status && statuses.length) {
      Promise.resolve().then(() => set("status", statuses[0].name));
    }
  }, [statuses, form.status]);

  const handleSave = async () => {
    if (!(form.client as string)?.trim())
      return alert("Client name is required");
    setSaving(true);
    await onSave(form as Partial<Lead>);
    setSaving(false);
  };

  const inp: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 3,
    display: "block",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 760,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>
            {lead?.id ? "✏️ Edit Lead" : "➕ New Lead"}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={lbl}>Client / Company *</label>
            <input
              style={inp}
              value={(form.client as string) || ""}
              onChange={(e) => set("client", e.target.value)}
              placeholder="Company name"
            />
          </div>
          <div>
            <label style={lbl}>Contact Person</label>
            <input
              style={inp}
              value={(form.contact_person as string) || ""}
              onChange={(e) => set("contact_person", e.target.value)}
              placeholder="Contact name"
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={lbl}>Email</label>
            <input
              type="email"
              style={inp}
              value={(form.contact_email as string) || ""}
              onChange={(e) => set("contact_email", e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label style={lbl}>Phone</label>
            <input
              style={inp}
              value={(form.contact_phone as string) || ""}
              onChange={(e) => set("contact_phone", e.target.value)}
              placeholder="+91 00000 00000"
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={lbl}>Lead Source</label>
            <select
              style={inp}
              value={(form.lead_source as string) || ""}
              onChange={(e) => set("lead_source", e.target.value)}
            >
              {LEAD_SOURCES.map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Reference / Lead From</label>
            <input
              style={inp}
              value={(form.reference_from as string) || ""}
              onChange={(e) => set("reference_from", e.target.value)}
              placeholder="Who referred / where from"
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={lbl}>Status</label>
            <select
              style={inp}
              value={(form.status as string) || ""}
              onChange={(e) => set("status", e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.id || s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Priority</label>
            <select
              style={inp}
              value={(form.priority as string) || ""}
              onChange={(e) => set("priority", e.target.value)}
            >
              {PRIORITIES.map((p: { value: string }) => (
                <option key={p.value} value={p.value}>
                  {p.value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Assigned To</label>
            <select
              style={inp}
              value={(form.assigned_to as string) || ""}
              onChange={(e) => set("assigned_to", e.target.value)}
            >
              <option value="">— Select member —</option>
              {memberOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={lbl}>Estimated Value (₹)</label>
            <input
              type="number"
              style={inp}
              value={(form.estimated_value as string) || ""}
              onChange={(e) => set("estimated_value", e.target.value)}
              placeholder="0"
              min="0"
            />
          </div>
          <div>
            <label style={lbl}>Target Date for Next Step</label>
            <input
              type="date"
              style={inp}
              value={(form.next_step_date as string) || ""}
              onChange={(e) => set("next_step_date", e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Action Taken</label>
          <textarea
            style={{ ...inp, minHeight: 70, resize: "vertical" }}
            value={(form.action_taken as string) || ""}
            onChange={(e) => set("action_taken", e.target.value)}
            placeholder="What has been done so far..."
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Next Step</label>
          <textarea
            style={{ ...inp, minHeight: 70, resize: "vertical" }}
            value={(form.next_step as string) || ""}
            onChange={(e) => set("next_step", e.target.value)}
            placeholder="What needs to happen next..."
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Remarks</label>
          <textarea
            style={{ ...inp, minHeight: 60, resize: "vertical" }}
            value={(form.remarks as string) || ""}
            onChange={(e) => set("remarks", e.target.value)}
            placeholder="Additional notes..."
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              background: "#f8fafc",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "8px 24px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              opacity: saving ? 0.8 : 1,
            }}
          >
            {saving ? "Saving…" : lead?.id ? "💾 Update Lead" : "✅ Add Lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
