import { useState, useEffect, useMemo } from "react";
import {
  CLIENTS as DEFAULT_CLIENTS,
  CATEGORIES as DEFAULT_CATEGORIES,
  TEAM_MEMBERS as DEFAULT_MEMBERS,
  COLUMNS,
  RECURRENCE_OPTIONS,
} from "@/constants";
import { computeStatus } from "@/lib/taskUtils";
import type { TaskModalProps } from "@/types/components";
import type { Task } from "@/types/task";

// Read live lists from localStorage (set by Masters page), fall back to constants
function readLS<T>(key: string): T[] | null {
  try {
    const v = localStorage.getItem(key);
    if (v) {
      const parsed = JSON.parse(v) as T[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getLiveClients(): string[] {
  const stored = readLS<{ name?: string } | string>("tt_clients");
  const names = stored
    ? stored
        .map((c) => (typeof c === "string" ? c : c.name || ""))
        .filter(Boolean)
    : [...DEFAULT_CLIENTS];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function getLiveCategories(): string[] {
  const stored = readLS<{ name?: string } | string>("tt_cats");
  const names = stored
    ? stored
        .map((c) => (typeof c === "string" ? c : c.name || ""))
        .filter(Boolean)
    : [...DEFAULT_CATEGORIES];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function getLiveMembers(): string[] {
  const stored = readLS<{ name?: string } | string>("tt_team");
  const names = stored
    ? stored
        .map((t) => (typeof t === "string" ? t : t.name || ""))
        .filter(Boolean)
    : [...DEFAULT_MEMBERS];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

const EMPTY: Partial<Task> = {
  client: "",
  category: "",
  description: "",
  status: "Pending",
  target_date: "",
  expected_date: "",
  comp_date: "",
  responsible: "",
  remarks: "",
  recurrence: "Onetime",
};

export default function TaskModal({
  task,
  defaultStatus,
  onSave,
  onClose,
}: TaskModalProps) {
  const initialForm = (): Partial<Task> =>
    task
      ? { ...EMPTY, ...task }
      : { ...EMPTY, status: defaultStatus || "Pending" };

  const [form, setForm] = useState<Partial<Task>>(initialForm);

  // Re-initialize when task/defaultStatus changes (e.g. opening a different task)
  useEffect(() => {
    setForm(
      task
        ? { ...EMPTY, ...task }
        : { ...EMPTY, status: defaultStatus || "Pending" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, defaultStatus]);

  // Read fresh from localStorage every time modal opens
  const clients = useMemo(() => getLiveClients(), []);
  const categories = useMemo(() => getLiveCategories(), []);
  const members = useMemo(() => getLiveMembers(), []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Live-computed status based on current form dates
  const liveStatus = computeStatus(form);
  const liveCol = COLUMNS.find((c) => c.id === liveStatus) || {
    color: "#6b7280",
    bg: "#f3f4f6",
    title: liveStatus,
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.description?.trim()) {
      alert("Please enter a task description.");
      return;
    }
    onSave({ ...form, id: task?.id } as Task);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            {task ? "Edit Task" : "Add New Task"}
          </span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Description – full width */}
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
              {/* Client */}
              <div className="form-group">
                <label>Client</label>
                <select
                  value={form.client}
                  onChange={(e) => set("client", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {clients.map((c: string) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {form.client === "__other__" && (
                  <input
                    type="text"
                    placeholder="Enter client name"
                    onChange={(e) => set("client", e.target.value)}
                    autoFocus
                  />
                )}
              </div>

              {/* Category */}
              <div className="form-group">
                <label>Category</label>
                <select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {categories.map((c: string) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {/* Recurrence */}
              <div className="form-group">
                <label>Recurrence</label>
                <select
                  value={form.recurrence}
                  onChange={(e) => set("recurrence", e.target.value)}
                >
                  {RECURRENCE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {form.recurrence !== "Onetime" && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {form.recurrence === "Monthly" &&
                      "⟳ Shown only in current & next month"}
                    {form.recurrence === "Quarterly" &&
                      "⟳ Shown when due this or next month"}
                    {form.recurrence === "Halfyearly" &&
                      "⟳ Shown when due this or next month"}
                    {form.recurrence === "Yearly" &&
                      "⟳ Shown when due this or next month"}
                  </div>
                )}
              </div>

              {/* Status — auto-computed from dates */}
              <div className="form-group">
                <label>Status (auto-computed)</label>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: liveCol.bg,
                    border: `2px solid ${liveCol.color}`,
                    color: liveCol.color,
                    fontWeight: 700,
                    fontSize: 13,
                    minHeight: 36,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: liveCol.color,
                      flexShrink: 0,
                    }}
                  />
                  {liveCol.title}
                </div>
              </div>

              {/* Responsible */}
              <div className="form-group">
                <label>Responsible</label>
                <select
                  value={form.responsible}
                  onChange={(e) => set("responsible", e.target.value)}
                >
                  <option value="">— Select —</option>
                  {members.map((m: string) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Date */}
              <div className="form-group">
                <label>Target Date</label>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(e) => set("target_date", e.target.value)}
                />
              </div>

              {/* Expected Date */}
              <div className="form-group">
                <label>Expected Date</label>
                <input
                  type="date"
                  value={form.expected_date}
                  onChange={(e) => set("expected_date", e.target.value)}
                />
              </div>

              {/* Completion Date */}
              <div className="form-group">
                <label>Completion Date</label>
                <input
                  type="date"
                  value={form.comp_date}
                  onChange={(e) => set("comp_date", e.target.value)}
                />
              </div>

              {/* Remarks – full width */}
              <div className="form-group full">
                <label>Remarks</label>
                <textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                  placeholder="Any notes or comments…"
                  rows={2}
                />
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <div className="modal-foot-left">
              {task && (
                <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                  Task #{task.s_no}
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {task ? "✓ Save Changes" : "+ Add Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
