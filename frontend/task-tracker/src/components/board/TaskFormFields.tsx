import { COLUMNS, RECURRENCE_OPTIONS, computeStatus } from "@/utils/task";
import type { MasterEntry } from "@/utils/masters";

interface FormState {
  client: string;
  category: string;
  description: string;
  status: string;
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  responsible: string;
  remarks: string;
  recurrence: string;
  organization: string;
}

interface Props {
  form: FormState;
  orgs: string[];
  filteredClients: string[];
  categories: string[];
  members: string[];
  clientObjects: MasterEntry[];
  set: (k: string, v: unknown) => void;
  onOrgChange: (org: string) => void;
  onClientChange: (client: string) => void;
}

export default function TaskFormFields({
  form,
  orgs,
  filteredClients,
  categories,
  members,
  set,
  onOrgChange,
  onClientChange,
}: Props) {
  const liveStatus = computeStatus(form as Parameters<typeof computeStatus>[0]);
  const liveCol = COLUMNS.find((c: { id: string }) => c.id === liveStatus) ?? {
    color: "#6b7280",
    bg: "#f3f4f6",
    title: liveStatus,
  };

  return (
    <div className="modal-body">
      <div className="form-group full" style={{ marginBottom: 14 }}>
        <label>Description *</label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What needs to be done?"
          rows={3}
          autoFocus
        />
      </div>

      <div className="form-grid">
        {orgs.length > 0 && (
          <div className="form-group">
            <label>🏢 Organization</label>
            <select value={form.organization} onChange={(e) => onOrgChange(e.target.value)}>
              <option value="">— All Organizations —</option>
              {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Client{form.organization ? ` (${form.organization})` : ""}</label>
          <select value={form.client} onChange={(e) => onClientChange(e.target.value)}>
            <option value="">— Select —</option>
            {filteredClients.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {form.client === "__other__" && (
            <input type="text" placeholder="Enter client name" onChange={(e) => set("client", e.target.value)} autoFocus />
          )}
        </div>

        <div className="form-group">
          <label>Category</label>
          <select value={form.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">— Select —</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Recurrence</label>
          <select value={form.recurrence} onChange={(e) => set("recurrence", e.target.value)}>
            {RECURRENCE_OPTIONS.map((r: { value: string; label: string }) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {form.recurrence !== "Onetime" && (
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>
              {form.recurrence === "Monthly" && "⟳ Shown only in current & next month"}
              {form.recurrence === "Quarterly" && "⟳ Shown when due this or next month"}
              {form.recurrence === "Halfyearly" && "⟳ Shown when due this or next month"}
              {form.recurrence === "Yearly" && "⟳ Shown when due this or next month"}
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Status (auto-computed)</label>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, background: liveCol.bg, border: `2px solid ${liveCol.color}`, color: liveCol.color, fontWeight: 700, fontSize: 13, minHeight: 36 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: liveCol.color, flexShrink: 0 }} />
            {liveCol.title}
          </div>
        </div>

        <div className="form-group">
          <label>Responsible</label>
          <select value={form.responsible} onChange={(e) => set("responsible", e.target.value)}>
            <option value="">— Select —</option>
            {members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Target Date</label>
          <input type="date" value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
        </div>

        <div className="form-group">
          <label>Expected Date</label>
          <input type="date" value={form.expectedDate} onChange={(e) => set("expectedDate", e.target.value)} />
        </div>

        <div className="form-group">
          <label>Completion Date</label>
          <input type="date" value={form.completedDate} onChange={(e) => set("completedDate", e.target.value)} />
        </div>

        <div className="form-group full">
          <label>Remarks</label>
          <textarea value={form.remarks} onChange={(e) => set("remarks", e.target.value)} placeholder="Any notes or comments…" rows={2} />
        </div>
      </div>
    </div>
  );
}
