import type { PaceActionItem, PaceMeetingStatusValue } from "@/types/api";
import { MEETING_STATUSES, inpS, lblS } from "@/utils/paceMeetings";
import type { MeetingForm } from "@/types/paceMeetings";

export interface MeetingEditModalProps {
  mode: "add" | "edit";
  form: MeetingForm;
  memberNames: string[];
  saving: boolean;
  updateForm: (patch: Partial<MeetingForm>) => void;
  addActionItem: () => void;
  updateAction: (idx: number, key: keyof PaceActionItem, value: string) => void;
  removeAction: (idx: number) => void;
  onSave: () => void;
  onDelete: (uid: string) => void;
  onClose: () => void;
}

export function MeetingEditModal({
  mode,
  form,
  memberNames,
  saving,
  updateForm,
  addActionItem,
  updateAction,
  removeAction,
  onSave,
  onDelete,
  onClose,
}: MeetingEditModalProps) {
  return (
    <div
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
      onClick={onClose}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 700,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 24px 14px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
            borderRadius: "14px 14px 0 0",
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 18,
              fontFamily: "var(--font-heading)",
              color: "var(--txt)",
            }}
          >
            {mode === "edit"
              ? "✏️ Edit Meeting"
              : `📅 Schedule ${form.meeting_type} Meeting`}
          </span>
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
        <div style={{ padding: "20px 24px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ gridColumn: "1/-1" }}>
              <label style={lblS}>Title *</label>
              <input
                style={inpS}
                value={form.title || ""}
                onChange={(e) => updateForm({ title: e.target.value })}
              />
            </div>
            <div>
              <label style={lblS}>Date *</label>
              <input
                type="date"
                style={inpS}
                value={form.scheduled_date || ""}
                onChange={(e) => updateForm({ scheduled_date: e.target.value })}
              />
            </div>
            <div>
              <label style={lblS}>Time</label>
              <input
                type="time"
                style={inpS}
                value={form.scheduled_time || ""}
                onChange={(e) => updateForm({ scheduled_time: e.target.value })}
              />
            </div>
            <div>
              <label style={lblS}>Status</label>
              <select
                style={inpS}
                value={form.status || "Scheduled"}
                onChange={(e) =>
                  updateForm({
                    status: e.target.value as PaceMeetingStatusValue,
                  })
                }
              >
                {MEETING_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lblS}>Conducted By</label>
              <input
                style={inpS}
                value={form.conducted_by || ""}
                onChange={(e) => updateForm({ conducted_by: e.target.value })}
              />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lblS}>Agenda</label>
            <textarea
              style={{
                ...inpS,
                minHeight: 150,
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
              value={form.agenda || ""}
              onChange={(e) => updateForm({ agenda: e.target.value })}
              onInput={(e) => {
                const ta = e.currentTarget;
                ta.style.height = "auto";
                ta.style.height = Math.max(150, ta.scrollHeight) + "px";
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lblS}>Meeting Minutes / Notes</label>
            <textarea
              style={{
                ...inpS,
                minHeight: 100,
                resize: "vertical",
                lineHeight: 1.6,
              }}
              value={form.minutes || ""}
              onChange={(e) => updateForm({ minutes: e.target.value })}
              placeholder="Record meeting notes here… (Shift+Enter for new line)"
              onInput={(e) => {
                const ta = e.currentTarget;
                ta.style.height = "auto";
                ta.style.height = Math.max(100, ta.scrollHeight) + "px";
              }}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#dc2626",
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>⚡ Action Items</span>
            <button
              onClick={addActionItem}
              style={{
                padding: "4px 10px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              + Add
            </button>
          </div>
          {(form.action_items || []).map((a, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 110px 80px 30px",
                gap: 8,
                marginBottom: 6,
                alignItems: "center",
              }}
            >
              <textarea
                style={{
                  ...inpS,
                  fontSize: 12,
                  minHeight: 32,
                  resize: "vertical",
                  lineHeight: 1.4,
                }}
                placeholder="Task description…"
                value={a.task}
                onChange={(e) => updateAction(i, "task", e.target.value)}
                onInput={(e) => {
                  const ta = e.currentTarget;
                  ta.style.height = "auto";
                  ta.style.height = Math.max(32, ta.scrollHeight) + "px";
                }}
              />
              <select
                style={{ ...inpS, fontSize: 12 }}
                value={a.assignee}
                onChange={(e) => updateAction(i, "assignee", e.target.value)}
              >
                <option value="">Assignee</option>
                {memberNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <input
                type="date"
                style={{ ...inpS, fontSize: 11 }}
                value={a.due_date || ""}
                onChange={(e) => updateAction(i, "due_date", e.target.value)}
              />
              <select
                style={{ ...inpS, fontSize: 11 }}
                value={a.status}
                onChange={(e) => updateAction(i, "status", e.target.value)}
              >
                <option>Open</option>
                <option>Done</option>
              </select>
              <button
                onClick={() => removeAction(i)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            position: "sticky",
            bottom: 0,
            background: "#fff",
            borderRadius: "0 0 14px 14px",
          }}
        >
          {mode === "edit" && form.id && (
            <button
              onClick={() => {
                if (form.id) onDelete(form.id);
              }}
              style={{
                marginRight: "auto",
                padding: "8px 14px",
                background: "#fee2e2",
                color: "#dc2626",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              🗑 Delete
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}
