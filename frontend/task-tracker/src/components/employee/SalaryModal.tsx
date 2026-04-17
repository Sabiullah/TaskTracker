import { inpS, lblS } from "@/utils/employee";
import type { Employee } from "@/types";

interface SalFormFieldProps {
  label: string;
  field: string;
  type?: string;
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  options?: Array<string | { value: string; label: string }>;
}

function SalFormField({
  label,
  field,
  type = "text",
  form,
  setForm,
  options,
}: SalFormFieldProps) {
  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));
  return (
    <div>
      <label style={lblS}>{label}</label>
      {options ? (
        <select
          style={inpS}
          value={(form[field] as string) || ""}
          onChange={onChange}
        >
          <option value="">— Select —</option>
          {options.map((o) =>
            typeof o === "object" ? (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ) : (
              <option key={o} value={o}>
                {o}
              </option>
            ),
          )}
        </select>
      ) : (
        <input
          type={type}
          style={inpS}
          value={(form[field] as string) || ""}
          onChange={onChange}
        />
      )}
    </div>
  );
}

export interface SalaryModalProps {
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  employees: Employee[];
}

export default function SalaryModal({
  form,
  setForm,
  onSave,
  onClose,
  saving,
  employees,
}: SalaryModalProps) {
  const empOptions = employees.map((e) => ({
    value: e.id,
    label: e.employee_name,
  }));
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
            {form.id ? "✏️ Edit Salary" : "➕ Add Salary Record"}
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
              fontSize: 13,
              fontWeight: 700,
              color: "#2563eb",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            👤 Employee & Designation
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <SalFormField
              label="Employee *"
              field="employee_id"
              form={form}
              setForm={setForm}
              options={empOptions}
            />
            <SalFormField
              label="Date of Joining"
              field="date_of_joining"
              type="date"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="Designation"
              field="designation"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="Department"
              field="department"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="Effective From"
              field="effective_from"
              type="date"
              form={form}
              setForm={setForm}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#16a34a",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            💰 Salary Breakdown
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <SalFormField
              label="Fixed Salary (CTC)"
              field="fixed_salary"
              type="number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="Basic Salary"
              field="basic_salary"
              type="number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="HRA"
              field="hra"
              type="number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="DA"
              field="da"
              type="number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="Other Allowances"
              field="other_allowances"
              type="number"
              form={form}
              setForm={setForm}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#d97706",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            📑 Statutory Details
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <SalFormField
              label="PF Number"
              field="pf_number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="ESI Number"
              field="esi_number"
              form={form}
              setForm={setForm}
            />
            <SalFormField
              label="UAN Number"
              field="uan_number"
              form={form}
              setForm={setForm}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            <SalFormField
              label="Remarks"
              field="remarks"
              form={form}
              setForm={setForm}
            />
          </div>
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
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
