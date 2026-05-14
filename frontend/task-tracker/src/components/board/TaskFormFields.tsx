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
  reportingManager: string;
  remarks: string;
  recurrence: string;
  /** Org UID the task belongs to (empty string = unset). */
  organization: string;
}

/** Minimal org shape for the dropdown — uid in the option value, name as
 *  the human label. Mirrors ``ProfileOrg`` without forcing the caller to
 *  import the full interface. */
export interface OrgOption {
  readonly uid: string;
  readonly name: string;
}

interface Props {
  form: FormState;
  /** Orgs the user may pick from. Each ``value`` in the dropdown is the
   *  org's uid; the option label is its name. */
  orgs: readonly OrgOption[];
  /** Each entry is the client's name plus whether the client is currently
   *  inactive — used to suffix "(inactive)" in the option label so the
   *  user understands why the picker shows a deactivated client (only
   *  reachable in Edit mode for the currently-bound row). */
  filteredClients: { name: string; inactive: boolean }[];
  categories: string[];
  members: string[];
  clientObjects: MasterEntry[];
  set: (k: string, v: unknown) => void;
  onOrgChange: (orgUid: string) => void;
  onClientChange: (client: string) => void;
  /** True when this form is creating a new task (vs. editing). The
   *  Reporting Manager field is mandatory on create only. */
  isCreate?: boolean;
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
  isCreate = false,
}: Props) {
  const liveStatus = computeStatus(form as Parameters<typeof computeStatus>[0]);
  const liveCol = COLUMNS.find((c: { id: string }) => c.id === liveStatus) ?? {
    color: "#6b7280",
    bg: "#f3f4f6",
    title: liveStatus,
  };

  // Resolve the currently-selected org's friendly name for the "Client
  // (<orgName>)" hint — displaying the raw uid there was what made the
  // UI look like it was leaking UUIDs onto the form.
  const selectedOrgName =
    orgs.find((o) => o.uid === form.organization)?.name ?? "";

  return (
    <div className="modal-body">
      <div className="form-group full" style={{ marginBottom: 14 }}>
        <label>Description *</label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = Math.max(ta.scrollHeight, 60) + "px";
          }}
          ref={(el) => {
            if (el) {
              el.style.height = "auto";
              el.style.height = Math.max(el.scrollHeight, 60) + "px";
            }
          }}
          placeholder="What needs to be done?"
          rows={3}
          style={{ resize: "vertical", overflow: "hidden" }}
          autoFocus
        />
      </div>

      <div className="form-grid">
        {orgs.length > 0 && (
          <div className="form-group">
            <label>🏢 Organization</label>
            <select value={form.organization} onChange={(e) => onOrgChange(e.target.value)}>
              <option value="">— All Organizations —</option>
              {orgs.map((o) => <option key={o.uid} value={o.uid}>{o.name}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Client{selectedOrgName ? ` (${selectedOrgName})` : ""}</label>
          <select value={form.client} onChange={(e) => onClientChange(e.target.value)}>
            <option value="">— Select —</option>
            {filteredClients.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}{c.inactive ? " (inactive)" : ""}
              </option>
            ))}
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
          <label>Reporting Manager{isCreate ? " *" : ""}</label>
          <select
            value={form.reportingManager}
            onChange={(e) => set("reportingManager", e.target.value)}
            required={isCreate}
          >
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
          <textarea
            value={form.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = Math.max(ta.scrollHeight, 48) + "px";
            }}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = Math.max(el.scrollHeight, 48) + "px";
              }
            }}
            placeholder="Any notes or comments…"
            rows={2}
            style={{ resize: "vertical", overflow: "hidden" }}
          />
        </div>
      </div>
    </div>
  );
}
