import { useState, useEffect, useMemo, useCallback } from "react";
import type { CSSProperties } from "react";
import type {
  Lead,
  LeadStatus,
  StatusMasterModalProps,
  LeadModalProps,
  HistoryModalProps,
  PipelineViewProps,
  FollowupLog,
} from "@/types/leads";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

// ── Default statuses (fallback if DB is empty) ─────────────────────────────────
const DEFAULT_STATUSES = [
  { name: "Cold", color: "#64748b", sort_order: 1 },
  { name: "Warm", color: "#d97706", sort_order: 2 },
  { name: "Hot", color: "#ea580c", sort_order: 3 },
  { name: "Confirmed", color: "#16a34a", sort_order: 4 },
  { name: "Cancelled", color: "#dc2626", sort_order: 5 },
];

// Preset color swatches for status master
const PRESET_COLORS = [
  "#64748b",
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#d97706",
  "#ea580c",
  "#dc2626",
  "#16a34a",
  "#059669",
];

const LEAD_SOURCES = [
  "Referral",
  "Cold Call",
  "Social Media",
  "Website",
  "Exhibition",
  "Walk-in",
  "Email Campaign",
  "LinkedIn",
  "Advertisement",
  "Client Referral",
  "Other",
];

const PRIORITIES = [
  { value: "High", color: "#dc2626", bg: "#fee2e2" },
  { value: "Medium", color: "#d97706", bg: "#fef3c7" },
  { value: "Low", color: "#16a34a", bg: "#dcfce7" },
];

const TODAY = new Date().toISOString().slice(0, 10);

// Derive light background from hex color
function hexBg(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.10)`;
}

const priorityStyle = (v: string): CSSProperties => {
  const p = PRIORITIES.find((x) => x.value === v);
  return p
    ? {
        background: p.bg,
        color: p.color,
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }
    : {};
};

const fmt = (d: string | null | undefined): string =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
    : "—";
const isOverdue = (d: string | null | undefined): boolean => !!(d && d < TODAY);

const BLANK = {
  client: "",
  contact_person: "",
  contact_email: "",
  contact_phone: "",
  lead_source: "Referral",
  reference_from: "",
  status: "",
  priority: "Medium",
  assigned_to: "",
  estimated_value: "",
  action_taken: "",
  next_step: "",
  next_step_date: "",
  remarks: "",
};

// ── CSV export ─────────────────────────────────────────────────────────────────
function exportCSV(leads: Lead[]) {
  const esc = (v: string | number | null | undefined) =>
    `"${String(v || "").replace(/"/g, '""')}"`;
  const hdrs = [
    "#",
    "Client",
    "Contact Person",
    "Email",
    "Phone",
    "Lead Source",
    "Reference From",
    "Status",
    "Priority",
    "Assigned To",
    "Est. Value",
    "Action Taken",
    "Next Step",
    "Next Step Date",
    "Remarks",
    "Created",
  ];
  const rows = leads.map((l: Lead) =>
    [
      l.s_no || "",
      esc(l.client),
      esc(l.contact_person),
      esc(l.contact_email),
      esc(l.contact_phone),
      esc(l.lead_source),
      esc(l.reference_from),
      esc(l.status),
      esc(l.priority),
      esc(l.assigned_to),
      l.estimated_value || "",
      esc(l.action_taken),
      esc(l.next_step),
      l.next_step_date || "",
      esc(l.remarks),
      (l.created_at || "").slice(0, 10),
    ].join(","),
  );
  const csv = [hdrs.join(","), ...rows].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: "leads.csv",
  });
  a.click();
}

// ── Status Master Modal (Admin only) ──────────────────────────────────────────
function StatusMasterModal({
  statuses,
  onClose,
  onRefresh,
}: StatusMasterModalProps) {
  const [list] = useState(statuses.map((s) => ({ ...s })));
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const addStatus = async () => {
    if (!newName.trim()) return alert("Enter a status name");
    if (list.some((s) => s.name.toLowerCase() === newName.trim().toLowerCase()))
      return alert("Status already exists");
    setSaving(true);
    const maxOrder = list.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
    await apiPost("/lead_statuses/", {
      name: newName.trim(),
      color: newColor,
      sort_order: maxOrder + 1,
    });
    setSaving(false);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    onRefresh();
  };

  const startEdit = (s: LeadStatus) => {
    setEditId(s.id ?? null);
    setEditName(s.name);
    setEditColor(s.color);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditColor("");
  };

  const saveEdit = async (s: LeadStatus) => {
    if (!editName.trim()) return alert("Name required");
    setSaving(true);
    await apiPatch(`/lead_statuses/${s.id}/`, {
      name: editName.trim(),
      color: editColor,
    });
    setSaving(false);
    cancelEdit();
    onRefresh();
  };

  const deleteStatus = async (s: LeadStatus) => {
    if (
      !window.confirm(
        `Delete status "${s.name}"? Leads with this status won't be affected.`,
      )
    )
      return;
    await apiDelete(`/lead_statuses/${s.id}/`);
    onRefresh();
  };

  const moveOrder = async (s: LeadStatus, dir: number) => {
    const idx = list.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const swap = list[swapIdx];
    await Promise.all([
      apiPatch(`/lead_statuses/${s.id}/`, { sort_order: swap.sort_order }),
      apiPatch(`/lead_statuses/${swap.id}/`, { sort_order: s.sort_order }),
    ]);
    onRefresh();
  };

  const inp: CSSProperties = {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1200,
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
          maxWidth: 520,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            ⚙️ Lead Status Master
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

        {/* Existing statuses */}
        <div style={{ marginBottom: 20 }}>
          {statuses.map((s, idx) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1.5px solid #e2e8f0",
                marginBottom: 6,
                background: "#fafafa",
              }}
            >
              {/* Color dot */}
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: s.color,
                  flexShrink: 0,
                }}
              />

              {editId === s.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ ...inp, flex: 1, padding: "4px 8px" }}
                  />
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {PRESET_COLORS.map((c) => (
                      <div
                        key={c}
                        onClick={() => setEditColor(c)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: c,
                          cursor: "pointer",
                          outline: editColor === c ? `3px solid ${c}` : "none",
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => saveEdit(s)}
                    disabled={saving}
                    style={{
                      padding: "4px 10px",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {saving ? "…" : "✓"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    style={{
                      padding: "4px 10px",
                      background: "#f1f5f9",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                    {s.name}
                  </span>
                  <span
                    style={{
                      background: hexBg(s.color),
                      color: s.color,
                      padding: "2px 9px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {s.name}
                  </span>
                  <button
                    onClick={() => moveOrder(s, -1)}
                    disabled={idx === 0}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                      opacity: idx === 0 ? 0.3 : 1,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveOrder(s, 1)}
                    disabled={idx === statuses.length - 1}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                      opacity: idx === statuses.length - 1 ? 0.3 : 1,
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => startEdit(s)}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteStatus(s)}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #fecaca",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff1f2",
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          {statuses.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              No statuses yet. Add one below.
            </div>
          )}
        </div>

        {/* Add new */}
        <div style={{ borderTop: "2px solid #f1f5f9", paddingTop: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              marginBottom: 8,
            }}
          >
            Add New Status
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Status name…"
              style={{ ...inp, flex: 1, minWidth: 120 }}
              onKeyDown={(e) => e.key === "Enter" && addStatus()}
            />
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {PRESET_COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setNewColor(c)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    outline:
                      newColor === c
                        ? `3px solid ${c}`
                        : "2px solid transparent",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            <button
              onClick={addStatus}
              disabled={saving}
              style={{
                padding: "7px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {saving ? "…" : "+ Add"}
            </button>
          </div>
          {newColor && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Preview:</span>
              <span
                style={{
                  background: hexBg(newColor),
                  color: newColor,
                  padding: "2px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {newName || "Status Name"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lead Add/Edit Modal ────────────────────────────────────────────────────────
function LeadModal({
  lead,
  statuses,
  memberOptions,
  onSave,
  onClose,
}: LeadModalProps) {
  const [form, setForm] = useState<Partial<Lead>>({ ...BLANK, ...lead });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Default status to first available — initialise only, no cascading render
  useEffect(() => {
    if (!form.status && statuses.length)
      setForm((f) => ({ ...f, status: statuses[0].name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses]);

  const handleSave = async () => {
    if (!form.client?.trim()) return alert("Client name is required");
    setSaving(true);
    await onSave(form as Lead);
    setSaving(false);
  };

  const inp: CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    boxSizing: "border-box" as const,
  };
  const lbl = {
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
              value={form.client}
              onChange={(e) => set("client", e.target.value)}
              placeholder="Company name"
            />
          </div>
          <div>
            <label style={lbl}>Contact Person</label>
            <input
              style={inp}
              value={form.contact_person}
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
              value={form.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label style={lbl}>Phone</label>
            <input
              style={inp}
              value={form.contact_phone}
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
              value={form.lead_source}
              onChange={(e) => set("lead_source", e.target.value)}
            >
              {LEAD_SOURCES.map((s) => (
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
              value={form.reference_from}
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
              value={form.status}
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
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {PRIORITIES.map((p) => (
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
              value={form.assigned_to}
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
              value={form.estimated_value}
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
              value={form.next_step_date}
              onChange={(e) => set("next_step_date", e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Action Taken</label>
          <textarea
            style={{ ...inp, minHeight: 70, resize: "vertical" }}
            value={form.action_taken}
            onChange={(e) => set("action_taken", e.target.value)}
            placeholder="What has been done so far..."
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Next Step</label>
          <textarea
            style={{ ...inp, minHeight: 70, resize: "vertical" }}
            value={form.next_step}
            onChange={(e) => set("next_step", e.target.value)}
            placeholder="What needs to happen next..."
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Remarks</label>
          <textarea
            style={{ ...inp, minHeight: 60, resize: "vertical" }}
            value={form.remarks}
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

// ── Follow-up History Modal ────────────────────────────────────────────────────
function HistoryModal({ lead, onClose }: HistoryModalProps) {
  const [logs, setLogs] = useState<FollowupLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await apiGet<FollowupLog[]>(
        `/lead_followups/?lead_id=${lead.id}`,
      );
      setLogs(data || []);
      setLoading(false);
    })();
  }, [lead.id]);

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const data = await apiPost<FollowupLog>("/lead_followups/", {
      lead: lead.id,
      note: note.trim(),
    });
    if (data) setLogs((l) => [data, ...l]);
    setNote("");
    setSaving(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1100,
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
          maxWidth: 560,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            📋 Follow-up Log — {lead.client}
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
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a follow-up note…"
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              fontSize: 13,
              resize: "vertical",
              minHeight: 60,
            }}
          />
          <button
            onClick={addNote}
            disabled={saving}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              alignSelf: "flex-end",
            }}
          >
            {saving ? "…" : "+ Add"}
          </button>
        </div>
        {loading ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            No follow-up notes yet.
          </div>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              style={{
                borderLeft: "3px solid #2563eb",
                paddingLeft: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 13 }}>{l.note}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                {new Date(l.created_at).toLocaleString("en-GB")}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Pipeline View ──────────────────────────────────────────────────────────────
function PipelineView({ leads, statuses, onEdit }: PipelineViewProps) {
  return (
    <div
      style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}
    >
      {statuses.map((st) => {
        const col = leads.filter((l) => l.status === st.name);
        const total = col.reduce(
          (s, l) => s + (Number(l.estimated_value) || 0),
          0,
        );
        const bg = hexBg(st.color);
        return (
          <div
            key={st.id || st.name}
            style={{ minWidth: 240, flex: "0 0 240px" }}
          >
            <div
              style={{
                background: bg,
                border: `2px solid ${st.color}40`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{ fontWeight: 700, color: st.color, fontSize: 13 }}
                >
                  {st.name}
                </span>
                <span
                  style={{
                    background: st.color,
                    color: "#fff",
                    borderRadius: 12,
                    padding: "1px 9px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {col.length}
                </span>
              </div>
              {total > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: st.color,
                    marginTop: 2,
                    opacity: 0.8,
                  }}
                >
                  ₹{total.toLocaleString("en-IN")}
                </div>
              )}
            </div>
            {col.map((l) => (
              <div
                key={l.id}
                onClick={() => onEdit(l)}
                style={{
                  background: "#fff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 9,
                  padding: "10px 12px",
                  marginBottom: 8,
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.boxShadow =
                    "0 3px 12px rgba(0,0,0,.12)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.boxShadow =
                    "0 1px 3px rgba(0,0,0,.06)")
                }
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#1e293b",
                    marginBottom: 4,
                  }}
                >
                  {l.client}
                </div>
                {l.contact_person && (
                  <div
                    style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}
                  >
                    👤 {l.contact_person}
                  </div>
                )}
                {l.assigned_to && (
                  <div
                    style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}
                  >
                    🧑 {l.assigned_to}
                  </div>
                )}
                {l.next_step_date && (
                  <div
                    style={{
                      fontSize: 11,
                      color: isOverdue(l.next_step_date)
                        ? "#dc2626"
                        : "#64748b",
                      marginBottom: 2,
                    }}
                  >
                    🗓 {fmt(l.next_step_date)}{" "}
                    {isOverdue(l.next_step_date) ? "⚠️" : ""}
                  </div>
                )}
                {Number(l.estimated_value) > 0 && (
                  <div
                    style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}
                  >
                    ₹{Number(l.estimated_value).toLocaleString("en-IN")}
                  </div>
                )}
                <div style={{ marginTop: 5 }}>
                  <span style={priorityStyle(l.priority || "")}>
                    {l.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LeadsPage({
  profile,
  profiles = [],
}: {
  profile: Record<string, unknown> | null;
  profiles?: Record<string, unknown>[];
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]); // from lead_statuses table
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Partial<Lead> | null>(null);
  const [histLead, setHistLead] = useState<Lead | null>(null);
  const [statusMgr, setStatusMgr] = useState(false);
  const [viewMode, setViewMode] = useState("table");

  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fMember, setFMember] = useState("");
  const [fSource, setFSource] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [search, setSearch] = useState("");

  const isAdmin = (profile as { role?: string })?.role === "admin";
  const isManager = (profile as { role?: string })?.role === "manager";
  const myName = (profile as { full_name?: string; name?: string })?.full_name || (profile as { name?: string })?.name || "";

  // ── Assigned To: only admin + manager roles ────────────────────────────────
  const memberOptions = useMemo(
    () =>
      (profiles as { role?: string; full_name?: string }[])
        .filter((p) => p.role === "admin" || p.role === "manager")
        .map((p) => p.full_name)
        .filter((n): n is string => Boolean(n))
        .sort(),
    [profiles],
  );

  // ── Load statuses from DB ──────────────────────────────────────────────────
  const loadStatuses = useCallback(async () => {
    const data = await apiGet<LeadStatus[]>("/lead_statuses/");
    if (data && data.length > 0) {
      setStatuses(data);
    } else {
      const inserted = await Promise.all(
        DEFAULT_STATUSES.map((s) => apiPost<LeadStatus>("/lead_statuses/", s)),
      );
      setStatuses(inserted || DEFAULT_STATUSES);
    }
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const data = await apiGet<Lead[]>("/leads/");
    // Client-side role scoping as safety net
    const scoped = (data || []).filter((l) => {
      if (isAdmin) return true;
      if (isManager) {
        const allowed = (profiles as { manager_ids?: string[]; manager_id?: string; id?: string; full_name?: string }[])
          .filter((p) => {
            const ids = p.manager_ids?.length ? p.manager_ids : p.manager_id ? [p.manager_id] : [];
            return ids.includes((profile as { id?: string })?.id || "");
          })
          .map((p) => p.full_name)
          .filter(Boolean);
        allowed.push(myName);
        return !l.assigned_to || allowed.includes(l.assigned_to);
      }
      return l.assigned_to === myName;
    });
    setLeads(scoped);
    setLoading(false);
  }, [isAdmin, isManager, myName, profiles, profile]);

  useEffect(() => {
    void (async () => {
      await loadStatuses();
    })();
  }, [loadStatuses]);

  useEffect(() => {
    void (async () => {
      await loadLeads();
    })();
  }, [loadLeads]);

  // Dynamic status style helper
  const statusBadge = useCallback(
    (name: string): CSSProperties => {
      const s = statuses.find((x) => x.name === name);
      const color = s?.color || "#64748b";
      return {
        background: hexBg(color),
        color,
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap" as const,
      };
    },
    [statuses],
  );

  // Filtered leads
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        (!fStatus || l.status === fStatus) &&
        (!fPriority || l.priority === fPriority) &&
        (!fMember || l.assigned_to === fMember) &&
        (!fSource || l.lead_source === fSource) &&
        (!fMonth ||
          (l.next_step_date || "").startsWith(fMonth) ||
          (l.created_at || "").startsWith(fMonth)) &&
        (!search ||
          [
            l.client,
            l.contact_person,
            l.reference_from,
            l.action_taken,
            l.next_step,
            l.remarks,
          ].some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [leads, fStatus, fPriority, fMember, fSource, fMonth, search]);

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const byStatus = Object.fromEntries(
      statuses.map((s) => [
        s.name,
        filtered.filter((l) => l.status === s.name).length,
      ]),
    );
    const confirmed = filtered.filter(
      (l) => l.status?.toLowerCase() === "confirmed",
    ).length;
    const convRate = total ? Math.round((confirmed / total) * 100) : 0;
    const totalVal = filtered.reduce(
      (s, l) => s + (Number(l.estimated_value) || 0),
      0,
    );
    const confVal = filtered
      .filter((l) => l.status?.toLowerCase() === "confirmed")
      .reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
    const overdueFollowups = filtered.filter(
      (l) =>
        isOverdue(l.next_step_date) &&
        l.status?.toLowerCase() !== "cancelled" &&
        l.status?.toLowerCase() !== "confirmed",
    ).length;
    return { total, byStatus, convRate, totalVal, confVal, overdueFollowups };
  }, [filtered, statuses]);

  const handleSave = useCallback(
    async (form: Partial<Lead>) => {
      const row = {
        client: form.client?.trim() ?? "",
        contact_person: form.contact_person?.trim() || null,
        contact_email: form.contact_email?.trim() || null,
        contact_phone: form.contact_phone?.trim() || null,
        lead_source: form.lead_source || null,
        reference_from: form.reference_from?.trim() || null,
        status: form.status || statuses[0]?.name || "Cold",
        priority: form.priority || "Medium",
        assigned_to: form.assigned_to || null,
        estimated_value: form.estimated_value
          ? Number(form.estimated_value)
          : null,
        action_taken: form.action_taken?.trim() || null,
        next_step: form.next_step?.trim() || null,
        next_step_date: form.next_step_date || null,
        remarks: form.remarks?.trim() || null,
      };
      if (form.id) {
        await apiPatch(`/leads/${form.id}/`, row);
      } else {
        const maxSNo = leads.reduce((m, l) => Math.max(m, l.s_no || 0), 0);
        await apiPost("/leads/", { ...row, s_no: maxSNo + 1 });
      }
      setModal(null);
      loadLeads();
    },
    [leads, statuses, loadLeads],
  );

  const handleDelete = useCallback(
    async (id: string | undefined) => {
      if (!id || !window.confirm("Delete this lead?")) return;
      await apiDelete(`/leads/${id}/`);
      loadLeads();
    },
    [loadLeads],
  );

  const handleStatusChange = useCallback(
    async (id: string | undefined, status: string) => {
      if (!id) return;
      await apiPatch(`/leads/${id}/`, { status });
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    },
    [],
  );

  // Available months
  const months = useMemo(() => {
    const keys = new Set<string>();
    leads.forEach((l) => {
      if (l.next_step_date) keys.add(l.next_step_date.slice(0, 7));
      if (l.created_at) keys.add(l.created_at.slice(0, 7));
    });
    return [...keys].sort().reverse();
  }, [leads]);

  const cardStyle = (c: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 14px",
    borderTop: `3px solid ${c}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    minWidth: 90,
  });
  const boxStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 10,
  };

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>
          🎯 Lead Management
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {isAdmin && (
            <button
              onClick={() => setStatusMgr(true)}
              style={{
                padding: "7px 14px",
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
                color: "#475569",
              }}
            >
              ⚙️ Manage Statuses
            </button>
          )}
          <div
            style={{
              display: "flex",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              overflow: "hidden",
            }}
          >
            {[
              ["table", "📋 Table"],
              ["pipeline", "🗂 Pipeline"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{
                  padding: "6px 14px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  background: viewMode === v ? "#2563eb" : "#fff",
                  color: viewMode === v ? "#fff" : "#64748b",
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={() => exportCSV(filtered)}
            style={{
              padding: "7px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            ⬇ Export
          </button>
          <button
            onClick={() =>
              setModal({ ...BLANK, status: statuses[0]?.name || "" })
            }
            style={{
              padding: "7px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            + New Lead
          </button>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}
      >
        <div style={cardStyle("#2563eb")}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.total}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            Total
          </div>
        </div>
        {statuses.map((s) => (
          <div key={s.id || s.name} style={cardStyle(s.color)}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>
              {stats.byStatus[s.name] || 0}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              {s.name}
            </div>
          </div>
        ))}
        <div style={cardStyle("#7c3aed")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed" }}>
            {stats.convRate}%
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            Conversion
          </div>
        </div>
        {stats.overdueFollowups > 0 && (
          <div style={cardStyle("#dc2626")}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
              {stats.overdueFollowups}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              Overdue
            </div>
          </div>
        )}
        {stats.totalVal > 0 && (
          <div style={cardStyle("#059669")}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#059669" }}>
              ₹{stats.totalVal.toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              Pipeline
            </div>
            {stats.confVal > 0 && (
              <div style={{ fontSize: 10, color: "#16a34a" }}>
                ₹{stats.confVal.toLocaleString("en-IN")} confirmed
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters — single compact row */}
      {(() => {
        const fs: CSSProperties = {
          padding: "4px 6px",
          border: "1.5px solid #e2e8f0",
          borderRadius: 5,
          fontSize: 11,
          width: "100%",
          boxSizing: "border-box" as const,
        };
        const lbl = (w: number | string): CSSProperties => ({
          display: "flex",
          flexDirection: "column" as const,
          gap: 2,
          width: w,
          flexShrink: 0,
        });
        const cap = {
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        };
        return (
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "7px 12px",
              boxShadow: "0 1px 4px rgba(0,0,0,.08)",
              marginBottom: 10,
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
            }}
          >
            <div style={lbl(150)}>
              <span style={cap}>Search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Client, step, ref…"
                style={{ ...fs, padding: "4px 8px" }}
              />
            </div>
            <div style={lbl(120)}>
              <span style={cap}>Status</span>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                style={fs}
              >
                <option value="">All</option>
                {statuses.map((s) => (
                  <option key={s.id || s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={lbl(100)}>
              <span style={cap}>Priority</span>
              <select
                value={fPriority}
                onChange={(e) => setFPriority(e.target.value)}
                style={fs}
              >
                <option value="">All</option>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.value}
                  </option>
                ))}
              </select>
            </div>
            {(isAdmin || isManager) && (
              <div style={lbl(110)}>
                <span style={cap}>Assigned To</span>
                <select
                  value={fMember}
                  onChange={(e) => setFMember(e.target.value)}
                  style={fs}
                >
                  <option value="">All</option>
                  {memberOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={lbl(130)}>
              <span style={cap}>Source</span>
              <select
                value={fSource}
                onChange={(e) => setFSource(e.target.value)}
                style={fs}
              >
                <option value="">All</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={lbl(110)}>
              <span style={cap}>Month</span>
              <select
                value={fMonth}
                onChange={(e) => setFMonth(e.target.value)}
                style={fs}
              >
                <option value="">All</option>
                {months.map((m: string) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {(fStatus ||
              fPriority ||
              fMember ||
              fSource ||
              fMonth ||
              search) && (
              <button
                onClick={() => {
                  setFStatus("");
                  setFPriority("");
                  setFMember("");
                  setFSource("");
                  setFMonth("");
                  setSearch("");
                }}
                style={{
                  padding: "4px 10px",
                  border: "1px solid #fecaca",
                  borderRadius: 5,
                  background: "#fff1f2",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "#dc2626",
                  fontWeight: 700,
                  flexShrink: 0,
                  alignSelf: "flex-end",
                }}
              >
                ✕ Clear
              </button>
            )}
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "#94a3b8",
                whiteSpace: "nowrap",
                flexShrink: 0,
                alignSelf: "flex-end",
                paddingBottom: 2,
              }}
            >
              {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        );
      })()}

      {/* Pipeline view */}
      {viewMode === "pipeline" && (
        <div style={boxStyle}>
          {loading ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : (
            <PipelineView
              leads={filtered}
              statuses={statuses}
              onEdit={(l) => setModal({ ...l })}
            />
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && (
        <div style={boxStyle}>
          {loading ? (
            <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>
              No leads found. Click <b>+ New Lead</b> to add one.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "#",
                      "Client",
                      "Contact",
                      "Lead Source / Ref",
                      "Assigned To",
                      "Status",
                      "Priority",
                      "Action Taken",
                      "Next Step",
                      "Next Step Date",
                      "Est. Value",
                      "Remarks",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          fontWeight: 700,
                          color: "#475569",
                          fontSize: 12,
                          borderBottom: "2px solid #e2e8f0",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const overdue =
                      isOverdue(l.next_step_date) &&
                      !["confirmed", "cancelled"].includes(
                        (l.status || "").toLowerCase(),
                      );
                    return (
                      <tr
                        key={l.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: overdue ? "#fff7ed" : "white",
                        }}
                      >
                        <td
                          style={{
                            padding: "7px 10px",
                            color: "#94a3b8",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.s_no}
                        </td>
                        <td style={{ padding: "7px 10px", minWidth: 130 }}>
                          <div style={{ fontWeight: 700, color: "#1e293b" }}>
                            {l.client}
                          </div>
                          {l.contact_person && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {l.contact_person}
                            </div>
                          )}
                          {l.contact_phone && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              📞 {l.contact_phone}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#64748b",
                            minWidth: 120,
                          }}
                        >
                          {l.contact_email || "—"}
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#64748b",
                            minWidth: 130,
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            {l.lead_source || "—"}
                          </div>
                          {l.reference_from && (
                            <div style={{ fontSize: 11 }}>
                              via {l.reference_from}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#475569",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.assigned_to || "—"}
                        </td>
                        <td
                          style={{ padding: "7px 10px", whiteSpace: "nowrap" }}
                        >
                          <select
                            value={l.status || ""}
                            onChange={(e) =>
                              handleStatusChange(l.id, e.target.value)
                            }
                            style={{
                              ...statusBadge(l.status || ""),
                              border: "none",
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            {statuses.map((s) => (
                              <option key={s.id || s.name} value={s.name}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td
                          style={{ padding: "7px 10px", whiteSpace: "nowrap" }}
                        >
                          <span style={priorityStyle(l.priority || "")}>
                            {l.priority}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#64748b",
                            minWidth: 160,
                            maxWidth: 220,
                          }}
                        >
                          <div
                            style={{
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {l.action_taken || "—"}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#475569",
                            minWidth: 160,
                            maxWidth: 220,
                          }}
                        >
                          <div
                            style={{
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {l.next_step || "—"}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            whiteSpace: "nowrap",
                            color: overdue ? "#dc2626" : "#64748b",
                            fontWeight: overdue ? 700 : 400,
                          }}
                        >
                          {fmt(l.next_step_date)} {overdue ? "⚠️" : ""}
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#16a34a",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.estimated_value
                            ? `₹${Number(l.estimated_value).toLocaleString("en-IN")}`
                            : "—"}
                        </td>
                        <td
                          style={{
                            padding: "7px 10px",
                            fontSize: 12,
                            color: "#64748b",
                            minWidth: 140,
                          }}
                        >
                          {l.remarks || "—"}
                        </td>
                        <td
                          style={{ padding: "7px 8px", whiteSpace: "nowrap" }}
                        >
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              onClick={() => setHistLead(l)}
                              title="Follow-up log"
                              style={{
                                padding: "4px 8px",
                                border: "1px solid #bfdbfe",
                                background: "#eff6ff",
                                borderRadius: 5,
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              📋
                            </button>
                            <button
                              onClick={() => setModal({ ...l })}
                              title="Edit"
                              style={{
                                padding: "4px 8px",
                                border: "1px solid #e2e8f0",
                                background: "#f8fafc",
                                borderRadius: 5,
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              ✏️
                            </button>
                            {(isAdmin || isManager) && (
                              <button
                                onClick={() => handleDelete(l.id)}
                                title="Delete"
                                style={{
                                  padding: "4px 8px",
                                  border: "1px solid #fecaca",
                                  background: "#fff1f2",
                                  borderRadius: 5,
                                  cursor: "pointer",
                                  fontSize: 12,
                                }}
                              >
                                🗑
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <LeadModal
          lead={modal}
          statuses={statuses}
          memberOptions={memberOptions}
          onSave={handleSave as (form: Lead) => Promise<void>}
          onClose={() => setModal(null)}
        />
      )}

      {/* Follow-up History */}
      {histLead && (
        <HistoryModal lead={histLead} onClose={() => setHistLead(null)} />
      )}

      {/* Status Master (admin only) */}
      {statusMgr && isAdmin && (
        <StatusMasterModal
          statuses={statuses}
          onClose={() => setStatusMgr(false)}
          onRefresh={() => {
            loadStatuses();
            setStatusMgr(false);
            setTimeout(loadStatuses, 300);
          }}
        />
      )}
    </div>
  );
}
