import { lblS } from "@/utils/tableStyles";
import { inpS } from "@/utils/paceGoals";
import type { GoalRow, ReviewForm } from "@/types/paceGoals";

export interface GoalReviewModalProps {
  goal: GoalRow;
  form: ReviewForm;
  setForm: (updater: (prev: ReviewForm) => ReviewForm) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}

export function GoalReviewModal({
  goal,
  form,
  setForm,
  saving,
  onSave,
  onClose,
}: GoalReviewModalProps) {
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
      }}
      onClick={onClose}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 440,
          maxWidth: "96vw",
          padding: 28,
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 18,
            marginBottom: 16,
            fontFamily: "var(--font-heading)",
            color: "var(--txt)",
          }}
        >
          ⭐ Record Review — {goal.title}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lblS}>Previous Rating</label>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#475569" }}>
            {form.previous_rating}/5
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lblS}>New Rating (1-5)</label>
          <input
            type="number"
            min="1"
            max="5"
            step="0.5"
            style={inpS}
            value={form.new_rating}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                new_rating: Number(e.target.value) || 0,
              }))
            }
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lblS}>Comments</label>
          <textarea
            style={{
              ...inpS,
              minHeight: 60,
              resize: "vertical",
              lineHeight: 1.5,
            }}
            value={form.comments || ""}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                comments: e.target.value,
              }))
            }
            placeholder="Feedback and observations… (Shift+Enter for new line)"
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = Math.max(60, ta.scrollHeight) + "px";
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {saving ? "Saving…" : "Save Review"}
          </button>
        </div>
      </div>
    </div>
  );
}
