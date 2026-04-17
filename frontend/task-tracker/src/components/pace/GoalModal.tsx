import { GoalFormField } from "./GoalFormField";
import {
  FOCUS,
  FREQ,
  GOAL_TYPES,
  ICEBERG,
  PRIORITIES,
  STATUS_LIST,
} from "@/utils/paceGoals";
import type { GoalForm } from "@/types/paceGoals";

export interface GoalModalProps {
  mode: "add" | "edit";
  form: GoalForm;
  setForm: (updater: (prev: GoalForm) => GoalForm) => void;
  saving: boolean;
  canEdit: boolean;
  visibleNames: string[];
  onSave: () => void;
  onClose: () => void;
}

export function GoalModal({
  mode,
  form,
  setForm,
  saving,
  canEdit,
  visibleNames,
  onSave,
  onClose,
}: GoalModalProps) {
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
          width: 640,
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
              ? "✏️ Edit Goal"
              : `➕ Add ${form.goal_type} Goal`}
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
              marginBottom: 14,
            }}
          >
            {canEdit && (
              <GoalFormField
                label="Employee"
                field="employee_name"
                form={form}
                setForm={setForm}
                options={visibleNames}
              />
            )}
            <GoalFormField
              label="Goal Type"
              field="goal_type"
              form={form}
              setForm={setForm}
              options={GOAL_TYPES}
            />
            <div style={{ gridColumn: "1/-1" }}>
              <GoalFormField
                label="Title *"
                field="title"
                form={form}
                setForm={setForm}
              />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <GoalFormField
                label="Description"
                field="description"
                form={form}
                setForm={setForm}
                textarea
              />
            </div>
            <GoalFormField
              label="Status"
              field="status"
              form={form}
              setForm={setForm}
              options={STATUS_LIST}
            />
            <GoalFormField
              label="Priority"
              field="priority"
              form={form}
              setForm={setForm}
              options={PRIORITIES}
            />
          </div>
          {form.goal_type === "Result" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <GoalFormField
                label="Success Criteria"
                field="success_criteria"
                form={form}
                setForm={setForm}
                textarea
              />
              <GoalFormField
                label="Frequency"
                field="frequency"
                form={form}
                setForm={setForm}
                options={FREQ}
              />
              <GoalFormField
                label="Target"
                field="target"
                form={form}
                setForm={setForm}
              />
              <GoalFormField
                label="How I Will Track"
                field="tracking_method"
                form={form}
                setForm={setForm}
              />
            </div>
          )}
          {form.goal_type === "Skill" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <GoalFormField
                label="Current Rating (1-5)"
                field="current_rating"
                type="number"
                form={form}
                setForm={setForm}
              />
              <GoalFormField
                label="Target Rating"
                field="target_rating"
                type="number"
                form={form}
                setForm={setForm}
              />
              <div style={{ gridColumn: "1/-1" }}>
                <GoalFormField
                  label="Learning Action Plan"
                  field="learning_action"
                  form={form}
                  setForm={setForm}
                  textarea
                />
              </div>
              <GoalFormField
                label="Completion By"
                field="completion_by"
                form={form}
                setForm={setForm}
              />
            </div>
          )}
          {form.goal_type === "Attitude" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <GoalFormField
                label="Iceberg Level"
                field="iceberg_level"
                form={form}
                setForm={setForm}
                options={ICEBERG}
              />
              <GoalFormField
                label="Current Rating (1-5)"
                field="current_rating"
                type="number"
                form={form}
                setForm={setForm}
              />
              <GoalFormField
                label="Focus Area"
                field="focus_area"
                form={form}
                setForm={setForm}
                options={FOCUS}
              />
              <GoalFormField
                label="Target Rating"
                field="target_rating"
                type="number"
                form={form}
                setForm={setForm}
              />
              <div style={{ gridColumn: "1/-1" }}>
                <GoalFormField
                  label="Daily/Weekly Practice Commitment"
                  field="daily_practice"
                  form={form}
                  setForm={setForm}
                  textarea
                />
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
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
            {saving ? "Saving…" : "Save Goal"}
          </button>
        </div>
      </div>
    </div>
  );
}
