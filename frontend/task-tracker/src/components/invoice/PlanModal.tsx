import { useState, useMemo } from "react";
import type { InvoicePlan } from "@/types";
import { getAllMonthsInRange, getApplicableMonths } from "@/utils/invoice";

export interface PlanModalProps {
  plan?: Partial<InvoicePlan> | null;
  onSave: (form: unknown) => Promise<void>; // TODO: type
  onClose: () => void;
}

export default function PlanModal({ plan, onSave, onClose }: PlanModalProps) {
  const [form, setForm] = useState({
    client_name: plan?.client_name ?? "",
    job_description: plan?.job_description ?? "",
    periodicity: plan?.periodicity ?? "Monthly",
    start_month: plan?.start_month ?? "",
    end_month: plan?.end_month ?? "",
    invoice_day: plan?.invoice_day ?? 1,
    base_amount:
      plan?.base_amount !== null && plan?.base_amount !== undefined
        ? String(plan.base_amount)
        : "",
    id: plan?.id,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
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

  const preview = useMemo(() => {
    if (!form.start_month || !form.end_month || !form.periodicity) return null;
    try {
      return getApplicableMonths(
        form,
        getAllMonthsInRange(form.start_month, form.end_month),
      ).length;
    } catch {
      return null;
    }
  }, [form]);

  const save = async () => {
    if (!(form.client_name as string)?.trim())
      return alert("Client name required");
    if (!(form.job_description as string)?.trim())
      return alert("Job description required");
    if (!form.start_month || !form.end_month)
      return alert("Start & end month required");
    if (form.start_month > form.end_month)
      return alert("Start must be before end month");
    if (!form.base_amount) return alert("Amount required");
    setSaving(true);
    await onSave(form);
    setSaving(false);
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
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 600,
          maxHeight: "92vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {plan?.id ? "✏️ Edit Invoice Plan" : "➕ New Invoice Plan"}
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
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Client Name *</label>
            <input
              style={inp}
              value={(form.client_name as string) || ""}
              onChange={(e) => set("client_name", e.target.value)}
              placeholder="Client / company name"
            />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Job Description *</label>
            <textarea
              style={{ ...inp, minHeight: 70, resize: "vertical" }}
              value={(form.job_description as string) || ""}
              onChange={(e) => set("job_description", e.target.value)}
              placeholder="Service / job details..."
            />
          </div>
          <div>
            <label style={lbl}>Periodicity</label>
            <select
              style={inp}
              value={(form.periodicity as string) || ""}
              onChange={(e) => set("periodicity", e.target.value)}
            >
              {/* @ts-expect-error — PERIODICITIES comes from the original JS module scope */}
              {PERIODICITIES.map((p: string) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Invoice Day of Month (1–31)</label>
            <input
              type="number"
              style={inp}
              value={form.invoice_day as number}
              min={1}
              max={31}
              onChange={(e) =>
                set(
                  "invoice_day",
                  Math.max(1, Math.min(31, parseInt(e.target.value) || 1)),
                )
              }
            />
          </div>
          <div>
            <label style={lbl}>Start Month *</label>
            <input
              type="month"
              style={inp}
              value={(form.start_month as string) || ""}
              onChange={(e) => set("start_month", e.target.value)}
            />
          </div>
          <div>
            <label style={lbl}>End Month *</label>
            <input
              type="month"
              style={inp}
              value={(form.end_month as string) || ""}
              onChange={(e) => set("end_month", e.target.value)}
            />
          </div>
          <div>
            <label style={lbl}>Base Amount (₹) *</label>
            <input
              type="number"
              style={inp}
              value={(form.base_amount as string) || ""}
              onChange={(e) => set("base_amount", e.target.value)}
              placeholder="0"
              min={0}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            {preview != null && (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 7,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#166534",
                  width: "100%",
                }}
              >
                ✅ <b>{preview}</b> invoice instances will be generated (
                {form.periodicity as string})
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 18px",
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
            onClick={save}
            disabled={saving}
            style={{
              padding: "7px 22px",
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
            {saving ? "Saving…" : plan?.id ? "💾 Update" : "✅ Create Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
