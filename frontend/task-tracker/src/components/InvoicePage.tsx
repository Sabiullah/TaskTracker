import React, { useState, useEffect, useMemo, useRef } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type {
  InvoicePlan,
  InvoiceEntry,
  PlanForm,
  AmountSavePayload,
  AmountModalState,
  InvModalState,
} from "@/types/invoice";

// ── FY / Date helpers ──────────────────────────────────────────────────────────
function getCurrentFY() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}
function getFYOptions() {
  const base = (() => {
    const n = new Date();
    return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
  })();
  return [-2, -1, 0, 1, 2].map((off) => {
    const y = base + off;
    return `${y}-${String(y + 1).slice(-2)}`;
  });
}
function getFYMonths(fy: string) {
  const startYear = parseInt(fy);
  return Array.from({ length: 12 }, (_, i) => {
    const mo = ((3 + i) % 12) + 1;
    const yr = startYear + (i < 9 ? 0 : 1);
    return `${yr}-${String(mo).padStart(2, "0")}`;
  });
}
function getAllMonthsInRange(start: string, end: string) {
  const months = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}
function getApplicableMonths(
  plan: { periodicity: string; start_month: string; end_month: string },
  months: string[],
) {
  const step =
    (
      { Monthly: 1, Quarterly: 3, "Half-yearly": 6, Yearly: 12 } as Record<
        string,
        number
      >
    )[plan.periodicity] || 1;
  const sD = new Date(plan.start_month + "-01");
  const eD = new Date(plan.end_month + "-01");
  return months.filter((m: string) => {
    const d = new Date(m + "-01");
    if (d < sD || d > eD) return false;
    const diff =
      (d.getFullYear() - sD.getFullYear()) * 12 + d.getMonth() - sD.getMonth();
    return diff % step === 0;
  });
}
function getInvoiceDate(ym: string, day: number) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(Math.min(day, new Date(y, m, 0).getDate())).padStart(2, "0")}`;
}
const fmtMoney = (v: number | string | null | undefined) =>
  v != null && v !== "" ? `₹${Number(v).toLocaleString("en-IN")}` : "—";
const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      })
    : "—";
const fmtMonth = (m: string | null | undefined) => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  const N = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${N[parseInt(mo) - 1]} ${y}`;
};

// ── Constants ──────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_SHORT = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
];
const PERIODICITIES = ["Monthly", "Quarterly", "Half-yearly", "Yearly"];
const STATUS_CFG = {
  Pending: {
    color: "#d97706",
    bg: "#fef3c7",
    icon: "⏳",
    label: "Pending Upload",
  },
  Uploaded: { color: "#2563eb", bg: "#eff6ff", icon: "📎", label: "Uploaded" },
  Approved: { color: "#16a34a", bg: "#f0fdf4", icon: "✅", label: "Approved" },
  Rejected: { color: "#dc2626", bg: "#fef2f2", icon: "❌", label: "Rejected" },
};
const isOverdue = (
  e: { status?: string; invoice_date?: string } | null | undefined,
) =>
  e?.status === "Pending" && e?.invoice_date != null && e.invoice_date < TODAY;
const thS = {
  padding: "7px 10px",
  textAlign: "left" as const,
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap" as const,
  background: "#f8fafc",
};
const tdS = {
  padding: "6px 10px",
  color: "#374151",
  verticalAlign: "middle" as const,
  fontSize: 12,
};

// ── Plan Modal ─────────────────────────────────────────────────────────────────
function PlanModal({
  plan,
  onSave,
  onClose,
}: {
  plan: Partial<InvoicePlan> | null;
  onSave: (form: PlanForm) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<PlanForm>({
    client_name: "",
    job_description: "",
    periodicity: "Monthly",
    start_month: "",
    end_month: "",
    invoice_day: 1,
    base_amount: "",
    ...plan,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof PlanForm, v: PlanForm[keyof PlanForm]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const inp = {
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
    if (!form.client_name.trim()) return alert("Client name required");
    if (!form.job_description.trim()) return alert("Job description required");
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
              value={form.client_name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("client_name", e.target.value)
              }
              placeholder="Client / company name"
            />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Job Description *</label>
            <textarea
              style={{ ...inp, minHeight: 70, resize: "vertical" }}
              value={form.job_description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                set("job_description", e.target.value)
              }
              placeholder="Service / job details..."
            />
          </div>
          <div>
            <label style={lbl}>Periodicity</label>
            <select
              style={inp}
              value={form.periodicity}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                set("periodicity", e.target.value as PlanForm["periodicity"])
              }
            >
              {PERIODICITIES.map((p) => (
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
              value={form.invoice_day}
              min={1}
              max={31}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
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
              value={form.start_month}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("start_month", e.target.value)
              }
            />
          </div>
          <div>
            <label style={lbl}>End Month *</label>
            <input
              type="month"
              style={inp}
              value={form.end_month}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("end_month", e.target.value)
              }
            />
          </div>
          <div>
            <label style={lbl}>Base Amount (₹) *</label>
            <input
              type="number"
              style={inp}
              value={form.base_amount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("base_amount", e.target.value)
              }
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
                {form.periodicity})
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

// ── Amount Edit Modal ──────────────────────────────────────────────────────────
function AmountEditModal({
  entry,
  baseAmount,
  month,
  onSave,
  onClose,
}: {
  entry: InvoiceEntry | null;
  baseAmount: number | string | undefined;
  month: string;
  onSave: (payload: AmountSavePayload) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number | string>(
    entry?.amount ?? baseAmount ?? "",
  );
  const [scope, setScope] = useState<"this_month" | "onwards">("onwards");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (amount === "" || isNaN(Number(amount)))
      return alert("Enter a valid amount");
    setSaving(true);
    await onSave({ amount: Number(amount), scope, month });
    setSaving(false);
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e: React.MouseEvent<HTMLDivElement>) =>
        e.target === e.currentTarget && onClose()
      }
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            ✏️ Edit Invoice Amount — {fmtMonth(month)}
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
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              display: "block",
              marginBottom: 4,
            }}
          >
            New Amount (₹)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setAmount(e.target.value)
            }
            min={0}
            autoFocus
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1.5px solid #2563eb",
              borderRadius: 6,
              fontSize: 14,
              boxSizing: "border-box" as const,
            }}
          />
        </div>
        <div
          style={{
            marginBottom: 20,
            background: "#f8fafc",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              marginBottom: 8,
            }}
          >
            Apply change to:
          </div>
          {(
            [
              ["this_month", `This month only (${fmtMonth(month)})`],
              ["onwards", "This month and all upcoming months"],
            ] as [string, string][]
          ).map(([v, l]) => (
            <label
              key={v}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                checked={scope === v}
                onChange={() => setScope(v as "this_month" | "onwards")}
              />
              <span
                style={{
                  color: scope === v ? "#2563eb" : "#374151",
                  fontWeight: scope === v ? 700 : 400,
                }}
              >
                {l}
              </span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              background: "#f8fafc",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "7px 20px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {saving ? "…" : "💾 Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Action Modal (Upload / Approve / View) ─────────────────────────────
function InvoiceActionModal({
  entry,
  plan,
  isAdmin,
  profile,
  onClose,
  onRefresh,
}: {
  entry: InvoiceEntry;
  plan: Partial<InvoicePlan> | null;
  isAdmin: boolean;
  profile: { id?: string } | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejReason, setRejReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [notes, setNotes] = useState(entry?.notes || "");
  const [invNum, setInvNum] = useState(entry?.invoice_number || "");
  const fileRef = useRef<HTMLInputElement>(null);
  const overdue = isOverdue(entry);
  const st =
    STATUS_CFG[entry.status as keyof typeof STATUS_CFG] || STATUS_CFG.Pending;

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entry_id", entry.id);
    formData.append("invoice_number", invNum || "");
    formData.append("notes", notes || "");
    try {
      const res = await fetch("/api/invoice_entries/upload/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("tt_access")}`,
        },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      alert("Upload failed: " + (e as Error).message);
    }
    setUploading(false);
    onRefresh();
  };

  const handleApprove = async () => {
    setSaving(true);
    await apiPatch(`/invoice_entries/${entry.id}/`, {
      status: "Approved",
      approved_by: profile?.id,
      approved_at: new Date().toISOString(),
    });
    setSaving(false);
    onRefresh();
  };

  const handleReject = async () => {
    if (!rejReason.trim()) return alert("Enter rejection reason");
    setSaving(true);
    await apiPatch(`/invoice_entries/${entry.id}/`, {
      status: "Rejected",
      rejection_reason: rejReason.trim(),
    });
    setSaving(false);
    onRefresh();
  };

  const handleDownload = async () => {
    if (!entry.file_path) return;
    window.open(`/api/invoice_entries/${entry.id}/download/`, "_blank");
  };

  const saveNotes = async () => {
    await apiPatch(`/invoice_entries/${entry.id}/`, {
      invoice_number: invNum || null,
      notes: notes || null,
    });
    alert("Saved!");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1050,
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
          maxWidth: 500,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            🧾 Invoice — {fmtMonth(entry.invoice_month)}
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

        {/* Info */}
        <div
          style={{
            background: "#f8fafc",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
          }}
        >
          {[
            ["Client", entry.client_name],
            ["Job", plan?.job_description],
            [
              "Invoice Date",
              fmtDate(entry.invoice_date) + (overdue ? " ⚠️ OVERDUE" : ""),
            ],
            ["Amount", fmtMoney(entry.amount)],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 13 }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: "#64748b",
                  width: 95,
                  flexShrink: 0,
                }}
              >
                {k}:
              </span>
              <span
                style={{
                  color:
                    k === "Invoice Date" && overdue ? "#dc2626" : "#1e293b",
                  fontWeight: k === "Invoice Date" && overdue ? 700 : 400,
                }}
              >
                {v || "—"}
              </span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: "#64748b",
                fontSize: 13,
                width: 95,
                flexShrink: 0,
              }}
            >
              Status:
            </span>
            <span
              style={{
                background: st.bg,
                color: st.color,
                padding: "2px 9px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {st.icon} {entry.status}
            </span>
          </div>
        </div>

        {/* Invoice # + Notes */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                display: "block",
                marginBottom: 3,
              }}
            >
              Invoice Number
            </label>
            <input
              value={invNum}
              onChange={(e) => setInvNum(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 5,
                fontSize: 12,
                boxSizing: "border-box" as const,
              }}
              placeholder="INV-001"
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={saveNotes}
              style={{
                padding: "6px 14px",
                border: "1px solid #e2e8f0",
                borderRadius: 5,
                background: "#f8fafc",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                width: "100%",
              }}
            >
              💾 Save Details
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              display: "block",
              marginBottom: 3,
            }}
          >
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 5,
              fontSize: 12,
              boxSizing: "border-box" as const,
              resize: "vertical" as const,
            }}
            placeholder="Any notes..."
          />
        </div>

        {/* Existing file */}
        {entry.file_name && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              padding: "8px 12px",
              background: "#eff6ff",
              borderRadius: 7,
              border: "1px solid #bfdbfe",
            }}
          >
            <span style={{ fontSize: 12, color: "#1e293b", flex: 1 }}>
              📎 {entry.file_name}
            </span>
            <button
              onClick={handleDownload}
              style={{
                padding: "4px 12px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ⬇ Download
            </button>
          </div>
        )}

        {/* Upload */}
        {["Pending", "Rejected"].includes(entry.status) && (
          <div style={{ marginBottom: 14 }}>
            {entry.rejection_reason && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  padding: "6px 10px",
                  marginBottom: 8,
                  fontSize: 12,
                  color: "#dc2626",
                }}
              >
                ❌ Rejected: {entry.rejection_reason}
              </div>
            )}
            <input
              type="file"
              ref={fileRef}
              style={{ display: "none" }}
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                e.target.files?.[0] && handleUpload(e.target.files[0])
              }
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                padding: "8px 18px",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                width: "100%",
                opacity: uploading ? 0.8 : 1,
              }}
            >
              {uploading ? "Uploading…" : "📤 Upload Invoice (PDF/Image)"}
            </button>
          </div>
        )}

        {/* Admin: approve/reject */}
        {isAdmin && entry.status === "Uploaded" && !showReject && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleApprove}
              disabled={saving}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              ✅ Approve Invoice
            </button>
            <button
              onClick={() => setShowReject(true)}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              ❌ Reject
            </button>
          </div>
        )}
        {isAdmin && showReject && (
          <div>
            <textarea
              value={rejReason}
              onChange={(e) => setRejReason(e.target.value)}
              rows={2}
              placeholder="Reason for rejection…"
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1.5px solid #fecaca",
                borderRadius: 6,
                fontSize: 13,
                boxSizing: "border-box" as const,
                marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowReject(false)}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ST_PRIORITY: Record<string, number> = {
  Pending: 0,
  Rejected: 1,
  Uploaded: 2,
  Approved: 3,
};

// ── Schedule Tab ───────────────────────────────────────────────────────────────
function ScheduleTab({
  plans,
  entries,
  fyMonths,
  loading,
  onSavePlan,
  onDeletePlan,
  onInvoiceClick,
  isAdmin,
}: {
  plans: InvoicePlan[];
  entries: InvoiceEntry[];
  fyMonths: string[];
  loading: boolean;
  onSavePlan: (form: PlanForm) => Promise<void>;
  onDeletePlan: (id: string) => void;
  onInvoiceClick: (
    entry: InvoiceEntry | null,
    plan: Partial<InvoicePlan>,
    month?: string,
  ) => void;
  isAdmin: boolean;
}) {
  const [addRow, setAddRow] = useState<PlanForm | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlanForm>({} as PlanForm);
  const [saving, setSaving] = useState(false);

  const BLANK: PlanForm = {
    client_name: "",
    job_description: "",
    periodicity: "Monthly",
    start_month: "",
    end_month: "",
    invoice_day: 1,
    base_amount: "",
  };
  const inpS = {
    padding: "4px 6px",
    border: "1.5px solid #cbd5e1",
    borderRadius: 4,
    fontSize: 11,
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#fff",
  };

  const startEdit = (plan: InvoicePlan) => {
    setEditRowId(plan.id);
    setEditForm({ ...plan });
    setAddRow(null);
  };
  const startAdd = () => {
    setAddRow({ ...BLANK });
    setEditRowId(null);
    setEditForm({ ...BLANK });
  };
  const cancelAll = () => {
    setAddRow(null);
    setEditRowId(null);
    setEditForm({ ...BLANK });
  };

  const saveRow = async (form: PlanForm) => {
    if (!form.client_name?.trim()) return alert("Client name required");
    if (!form.job_description?.trim()) return alert("Job description required");
    if (!form.start_month || !form.end_month)
      return alert("Start & end month required");
    if (form.start_month > form.end_month)
      return alert("Start must be before end month");
    if (!form.base_amount) return alert("Amount required");
    setSaving(true);
    await onSavePlan(form);
    setSaving(false);
    cancelAll();
  };

  /* Inline editable row — for add new or edit existing plan */
  const renderEditRow = (
    form: PlanForm,
    setForm: (updater: (f: PlanForm) => PlanForm) => void,
    key: string,
  ) => (
    <tr
      key={key}
      style={{ background: "#f0f9ff", borderBottom: "2px solid #2563eb" }}
    >
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <input
          style={inpS}
          value={form.client_name || ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setForm((f) => ({ ...f, client_name: e.target.value }))
          }
          placeholder="Client name *"
          autoFocus
        />
      </td>
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <textarea
          style={{ ...inpS, minHeight: 38, resize: "vertical" }}
          value={form.job_description || ""}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setForm((f) => ({ ...f, job_description: e.target.value }))
          }
          placeholder="Job description *"
          rows={2}
        />
      </td>
      <td style={{ ...tdS, padding: "4px 6px", verticalAlign: "top" }}>
        <select
          style={inpS}
          value={form.periodicity || "Monthly"}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setForm((f) => ({
              ...f,
              periodicity: e.target.value as PlanForm["periodicity"],
            }))
          }
        >
          {PERIODICITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td
        style={{
          ...tdS,
          padding: "4px 6px",
          textAlign: "center",
          verticalAlign: "top",
        }}
      >
        <input
          type="number"
          style={{ ...inpS, width: 48 }}
          value={form.invoice_day || 1}
          min={1}
          max={31}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setForm((f) => ({
              ...f,
              invoice_day: Math.max(
                1,
                Math.min(31, parseInt(e.target.value) || 1),
              ),
            }))
          }
        />
      </td>
      <td
        colSpan={fyMonths.length}
        style={{ ...tdS, padding: "6px 10px", verticalAlign: "top" }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            Start Month{" "}
            <input
              type="month"
              style={{ ...inpS, width: 140 }}
              value={form.start_month || ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, start_month: e.target.value }))
              }
            />
          </label>
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            End Month{" "}
            <input
              type="month"
              style={{ ...inpS, width: 140 }}
              value={form.end_month || ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, end_month: e.target.value }))
              }
            />
          </label>
          <label
            style={{
              fontSize: 11,
              color: "#64748b",
              display: "flex",
              gap: 4,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            Base Amount ₹{" "}
            <input
              type="number"
              style={{ ...inpS, width: 100 }}
              value={form.base_amount || ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, base_amount: e.target.value }))
              }
              placeholder="0"
              min={0}
            />
          </label>
        </div>
      </td>
      <td
        style={{
          ...tdS,
          padding: "4px 6px",
          whiteSpace: "nowrap",
          verticalAlign: "top",
        }}
      >
        <button
          onClick={() => saveRow(form)}
          disabled={saving}
          style={{
            padding: "5px 10px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            marginRight: 4,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "✓ Save"}
        </button>
        <button
          onClick={cancelAll}
          style={{
            padding: "5px 8px",
            background: "#fff",
            color: "#ef4444",
            border: "1px solid #fecaca",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );

  /* Group plans by client — one display row per client */
  const clientGroups = useMemo(() => {
    const map: Record<string, InvoicePlan[]> = {};
    plans.forEach((p) => {
      if (!map[p.client_name]) map[p.client_name] = [];
      map[p.client_name].push(p);
    });
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => (a.s_no || 0) - (b.s_no || 0)),
    );
    return map;
  }, [plans]);

  const clientMonthEntries = useMemo(() => {
    const map: Record<string, InvoiceEntry[]> = {};
    entries.forEach((e) => {
      const key = `${e.client_name}|${e.invoice_month}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [entries]);

  const compositeStatus = (monthEntries: InvoiceEntry[]) => {
    if (!monthEntries.length) return null;
    return monthEntries.reduce(
      (w, e) => (ST_PRIORITY[e.status] <= ST_PRIORITY[w.status] ? e : w),
      monthEntries[0],
    );
  };

  const clientNames = Object.keys(clientGroups).sort();

  if (loading)
    return <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {clientNames.length} client{clientNames.length !== 1 ? "s" : ""} ·{" "}
          {plans.length} plan{plans.length !== 1 ? "s" : ""}
        </span>
        {isAdmin && !addRow && !editRowId && (
          <button
            onClick={startAdd}
            style={{
              padding: "6px 14px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            + Add Plan
          </button>
        )}
      </div>

      {plans.length === 0 && !addRow ? (
        <div
          style={{
            color: "#94a3b8",
            textAlign: "center",
            padding: 40,
            fontSize: 14,
          }}
        >
          No invoice plans. {isAdmin && "Click + Add Plan to begin."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, minWidth: 140 }}>Client</th>
                <th style={{ ...thS, minWidth: 220 }}>
                  Job Description (all services)
                </th>
                <th style={{ ...thS, width: 50, textAlign: "center" as const }}>
                  Day
                </th>
                {fyMonths.map((m, i) => (
                  <th
                    key={m}
                    style={{
                      ...thS,
                      textAlign: "center" as const,
                      width: 68,
                      background:
                        m.slice(0, 7) === TODAY.slice(0, 7)
                          ? "#dbeafe"
                          : "#f8fafc",
                    }}
                  >
                    {MONTH_SHORT[i]}
                  </th>
                ))}
                {isAdmin && <th style={{ ...thS, minWidth: 110 }}>Plans</th>}
              </tr>
            </thead>
            <tbody>
              {clientNames.map((clientName) => {
                const clientPlans = clientGroups[clientName];

                /* If any plan in this group is being edited, show edit row */
                const editingPlan = clientPlans.find((p) => p.id === editRowId);
                if (editingPlan)
                  return renderEditRow(
                    editForm,
                    setEditForm,
                    clientName + "-edit",
                  );

                /* Days: show unique invoice days */
                const days = [
                  ...new Set(clientPlans.map((p) => p.invoice_day)),
                ].join(", ");

                return (
                  <tr
                    key={clientName}
                    style={{ borderBottom: "2px solid #e2e8f0" }}
                  >
                    {/* Client */}
                    <td
                      style={{ ...tdS, fontWeight: 800, verticalAlign: "top" }}
                    >
                      {clientName}
                    </td>

                    {/* Job Description — all services joined with + */}
                    <td
                      style={{
                        ...tdS,
                        verticalAlign: "top",
                        color: "#374151",
                        maxWidth: 250,
                      }}
                    >
                      {clientPlans.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && (
                            <span
                              style={{
                                color: "#94a3b8",
                                fontWeight: 700,
                                margin: "0 4px",
                              }}
                            >
                              +
                            </span>
                          )}
                          <span style={{ color: "#475569" }}>
                            {p.job_description}
                          </span>
                          <span
                            style={{
                              color: "#94a3b8",
                              fontSize: 10,
                              marginLeft: 3,
                            }}
                          >
                            ({p.periodicity})
                          </span>
                        </span>
                      ))}
                    </td>

                    {/* Invoice Day */}
                    <td
                      style={{
                        ...tdS,
                        textAlign: "center" as const,
                        color: "#64748b",
                        verticalAlign: "top",
                      }}
                    >
                      {days}
                    </td>

                    {/* Month cells — one per FY month, grouped by client */}
                    {fyMonths.map((m) => {
                      /* Plans applicable this month for this client */
                      const applicablePlans = clientPlans.filter(
                        (p) => getApplicableMonths(p, [m]).length > 0,
                      );
                      const monthEntries =
                        clientMonthEntries[`${clientName}|${m}`] || [];
                      const hasAny = applicablePlans.length > 0;

                      /* Total amount: from entries if available, else sum of base_amounts */
                      const totalAmt =
                        monthEntries.length > 0
                          ? monthEntries.reduce(
                              (s, e) => s + Number(e.amount || 0),
                              0,
                            )
                          : applicablePlans.reduce(
                              (s, p) => s + Number(p.base_amount || 0),
                              0,
                            );

                      const hasOverdue = monthEntries.some((e) => isOverdue(e));
                      const worst = compositeStatus(monthEntries);
                      const allApproved =
                        monthEntries.length > 0 &&
                        monthEntries.every((e) => e.status === "Approved");

                      /* Descriptions applicable only this month (for tooltip + modal) */
                      const monthDesc = applicablePlans
                        .map((p) => p.job_description)
                        .join(" + ");

                      /* Primary entry for click action */
                      const primaryEntry =
                        monthEntries.find((e) =>
                          ["Pending", "Rejected"].includes(e.status),
                        ) ||
                        monthEntries.find((e) => e.status === "Uploaded") ||
                        monthEntries[0] ||
                        null;

                      /* Synthetic plan object carrying combined description */
                      const syntheticPlan = {
                        ...applicablePlans[0],
                        client_name: clientName,
                        job_description: monthDesc,
                      };

                      return (
                        <td
                          key={m}
                          style={{
                            padding: "3px 2px",
                            textAlign: "center" as const,
                            background: hasOverdue
                              ? "#fef2f2"
                              : hasAny
                                ? "#fafafa"
                                : "transparent",
                            cursor: hasAny ? "pointer" : "default",
                            verticalAlign: "middle",
                          }}
                        >
                          {hasAny && (
                            <div
                              onClick={() =>
                                primaryEntry
                                  ? onInvoiceClick(
                                      { ...primaryEntry, amount: totalAmt },
                                      syntheticPlan,
                                    )
                                  : onInvoiceClick(null, syntheticPlan, m)
                              }
                              title={monthDesc}
                              style={{
                                borderRadius: 5,
                                padding: "3px 4px",
                                display: "inline-block",
                                minWidth: 64,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: hasOverdue
                                    ? "#dc2626"
                                    : allApproved
                                      ? "#16a34a"
                                      : "#1e293b",
                                }}
                              >
                                {totalAmt.toLocaleString("en-IN")}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: worst
                                    ? STATUS_CFG[
                                        worst.status as keyof typeof STATUS_CFG
                                      ]?.color
                                    : "#94a3b8",
                                }}
                              >
                                {worst
                                  ? STATUS_CFG[
                                      worst.status as keyof typeof STATUS_CFG
                                    ]?.icon
                                  : "⏳"}{" "}
                                {hasOverdue ? "⚠️" : ""}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Actions — per-plan edit/delete stacked */}
                    {isAdmin && (
                      <td
                        style={{
                          ...tdS,
                          verticalAlign: "top",
                          padding: "4px 8px",
                        }}
                      >
                        {clientPlans.map((p) => (
                          <div
                            key={p.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              marginBottom: 4,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 9,
                                color: "#94a3b8",
                                maxWidth: 55,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flexShrink: 1,
                              }}
                              title={p.job_description}
                            >
                              {p.job_description.length > 10
                                ? p.job_description.slice(0, 10) + "…"
                                : p.job_description}
                            </span>
                            <button
                              onClick={() => startEdit(p)}
                              style={{
                                padding: "2px 5px",
                                border: "1px solid #e2e8f0",
                                borderRadius: 4,
                                cursor: "pointer",
                                background: "#f8fafc",
                                fontSize: 10,
                              }}
                              title={`Edit: ${p.job_description}`}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => onDeletePlan(p.id)}
                              style={{
                                padding: "2px 5px",
                                border: "1px solid #fecaca",
                                borderRadius: 4,
                                cursor: "pointer",
                                background: "#fff1f2",
                                fontSize: 10,
                              }}
                              title={`Delete: ${p.job_description}`}
                            >
                              🗑
                            </button>
                          </div>
                        ))}
                      </td>
                    )}
                  </tr>
                );
              })}
              {/* New plan inline row appended at the bottom */}
              {addRow &&
                renderEditRow(
                  addRow,
                  (updater) => setAddRow((f) => (f ? updater(f) : f)),
                  "add-new",
                )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ────────────────────────────────────────────────────────────────
function SummaryTab({
  entries,
  fyMonths,
  loading,
}: {
  entries: InvoiceEntry[];
  fyMonths: string[];
  loading: boolean;
}) {
  const [fClient, setFClient] = useState("");
  const summary = useMemo(() => {
    const map: Record<
      string,
      Record<string, { total: number; approved: number; pending: number }>
    > = {};
    entries
      .filter((e) => fyMonths.includes(e.invoice_month))
      .forEach((e) => {
        if (!map[e.client_name]) map[e.client_name] = {};
        if (!map[e.client_name][e.invoice_month])
          map[e.client_name][e.invoice_month] = {
            total: 0,
            approved: 0,
            pending: 0,
          };
        const a = Number(e.amount || 0);
        map[e.client_name][e.invoice_month].total += a;
        if (e.status === "Approved")
          map[e.client_name][e.invoice_month].approved += a;
        else if (["Pending", "Uploaded"].includes(e.status))
          map[e.client_name][e.invoice_month].pending += a;
      });
    return map;
  }, [entries, fyMonths]);

  const clients = Object.keys(summary)
    .sort()
    .filter((c) => !fClient || c === fClient);
  const colTotals = fyMonths.map((m) =>
    clients.reduce((s, c) => s + (summary[c]?.[m]?.total || 0), 0),
  );
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);
  const allClients = Object.keys(summary).sort();

  if (loading)
    return <div style={{ padding: 20, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{
            padding: "4px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 5,
            fontSize: 12,
          }}
        >
          <option value="">All Clients</option>
          {allClients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          ✅ Approved 🟡 Pending
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead>
            <tr>
              <th style={{ ...thS, minWidth: 150 }}>Client</th>
              {fyMonths.map((m, i) => (
                <th
                  key={m}
                  style={{ ...thS, textAlign: "right" as const, width: 80 }}
                >
                  {MONTH_SHORT[i]}
                </th>
              ))}
              <th style={{ ...thS, textAlign: "right" as const, width: 90 }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td
                  colSpan={fyMonths.length + 2}
                  style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}
                >
                  No invoice data for this FY
                </td>
              </tr>
            ) : (
              clients.map((client) => {
                const rowTotal = fyMonths.reduce(
                  (s, m) => s + (summary[client]?.[m]?.total || 0),
                  0,
                );
                return (
                  <tr
                    key={client}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    <td style={{ ...tdS, fontWeight: 700 }}>{client}</td>
                    {fyMonths.map((m) => {
                      const cell = summary[client]?.[m];
                      return (
                        <td
                          key={m}
                          style={{ ...tdS, textAlign: "right" as const }}
                        >
                          {cell?.total ? (
                            <div>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cell.approved === cell.total
                                      ? "#16a34a"
                                      : "#1e293b",
                                }}
                              >
                                ₹{cell.total.toLocaleString("en-IN")}
                              </div>
                              {cell.pending > 0 && (
                                <div style={{ fontSize: 10, color: "#d97706" }}>
                                  🟡 ₹{cell.pending.toLocaleString("en-IN")}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#e2e8f0" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      style={{
                        ...tdS,
                        textAlign: "right" as const,
                        fontWeight: 700,
                        color: "#2563eb",
                      }}
                    >
                      ₹{rowTotal.toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {clients.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                <td style={tdS}>Monthly Total</td>
                {colTotals.map((t, i) => (
                  <td
                    key={i}
                    style={{
                      ...tdS,
                      textAlign: "right" as const,
                      color: t ? "#16a34a" : "#94a3b8",
                    }}
                  >
                    {t ? `₹${t.toLocaleString("en-IN")}` : "—"}
                  </td>
                ))}
                <td
                  style={{
                    ...tdS,
                    textAlign: "right" as const,
                    color: "#2563eb",
                  }}
                >
                  ₹{grandTotal.toLocaleString("en-IN")}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Invoices Tab ───────────────────────────────────────────────────────────────
function InvoicesTab({
  entries,
  plans,
  fyMonths,
  isAdmin,
  profile,
  onRefresh,
  onAmountEdit,
}: {
  entries: InvoiceEntry[];
  plans: InvoicePlan[];
  fyMonths: string[];
  isAdmin: boolean;
  profile: { id?: string } | null;
  onRefresh: () => void;
  onAmountEdit: (
    entry: InvoiceEntry,
    plan: Partial<InvoicePlan>,
    month: string,
  ) => void;
}) {
  const [fStatus, setFStatus] = useState("");
  const [fClient, setFClient] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [active, setActive] = useState<InvModalState | null>(null);
  const planMap = useMemo(
    () => Object.fromEntries(plans.map((p) => [p.id, p])),
    [plans],
  );
  const clients = useMemo(
    () => [...new Set(entries.map((e) => e.client_name))].sort(),
    [entries],
  );
  const fyEntries = useMemo(
    () => entries.filter((e) => fyMonths.includes(e.invoice_month)),
    [entries, fyMonths],
  );
  const overdueCnt = fyEntries.filter(isOverdue).length;

  const filtered = useMemo(
    () =>
      fyEntries
        .filter((e) => !fClient || e.client_name === fClient)
        .filter((e) => !fMonth || e.invoice_month === fMonth)
        .filter(
          (e) =>
            !fStatus ||
            (fStatus === "Overdue" ? isOverdue(e) : e.status === fStatus),
        )
        .sort((a, b) => (a.invoice_date < b.invoice_date ? -1 : 1)),
    [fyEntries, fClient, fMonth, fStatus],
  );

  /* Group filtered entries by client+month — one row per group (one invoice per client per month) */
  const groupedFiltered = useMemo(() => {
    const map: Record<string, InvoiceEntry[]> = {};
    const order: string[] = [];
    filtered.forEach((e) => {
      const key = `${e.client_name}|${e.invoice_month}`;
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(e);
    });
    return order.map((key) => {
      const group = map[key];
      const [clientName, invoiceMonth] = key.split("|");
      /* Combined unique job descriptions joined with + */
      const jobDesc = group
        .map((e) => planMap[e.plan_id]?.job_description)
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" + ");
      /* Summed amount */
      const totalAmt = group.reduce((s, e) => s + Number(e.amount || 0), 0);
      /* Worst-status entry is the primary action target */
      const primaryEntry = group.reduce(
        (w, e) => (ST_PRIORITY[e.status] <= ST_PRIORITY[w.status] ? e : w),
        group[0],
      );
      /* Earliest invoice date */
      const invoiceDate = group.map((e) => e.invoice_date).sort()[0];
      /* Unique invoice numbers */
      const invNums = [
        ...new Set(group.map((e) => e.invoice_number).filter(Boolean)),
      ].join(", ");
      /* Any uploaded file */
      const withFile = group.find((e) => e.file_name);
      const hasOverdueGroup = group.some((e) => isOverdue(e));
      return {
        key,
        clientName,
        invoiceMonth,
        jobDesc,
        totalAmt,
        primaryEntry,
        invoiceDate,
        invNums,
        withFile,
        hasOverdueGroup,
        group,
      };
    });
  }, [filtered, planMap]);

  const clearAll = () => {
    setFStatus("");
    setFClient("");
    setFMonth("");
  };
  const hasFilter = fStatus || fClient || fMonth;
  const fs = {
    padding: "4px 8px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 5,
    fontSize: 12,
    background: "#fff",
    color: "#374151",
  };

  /* Totals derived from grouped rows */
  const filteredTotal = groupedFiltered.reduce((s, g) => s + g.totalAmt, 0);
  const filteredApproved = groupedFiltered
    .filter((g) => g.primaryEntry.status === "Approved")
    .reduce((s, g) => s + g.totalAmt, 0);
  const filteredPending = groupedFiltered
    .filter((g) => ["Pending", "Uploaded"].includes(g.primaryEntry.status))
    .reduce((s, g) => s + g.totalAmt, 0);
  const filteredRejected = groupedFiltered
    .filter((g) => g.primaryEntry.status === "Rejected")
    .reduce((s, g) => s + g.totalAmt, 0);

  return (
    <div>
      {/* Filter bar — single row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "nowrap",
        }}
      >
        {overdueCnt > 0 && (
          <span
            onClick={() => {
              setFStatus("Overdue");
              setFMonth("");
            }}
            style={{
              background: "#fef2f2",
              color: "#dc2626",
              padding: "3px 10px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 700,
              border: "1px solid #fecaca",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚠️ {overdueCnt} Overdue
          </span>
        )}
        <select
          value={fMonth}
          onChange={(e) => setFMonth(e.target.value)}
          style={{ ...fs, flex: "1 1 130px", minWidth: 0 }}
        >
          <option value="">All Months</option>
          {fyMonths.map((m, i) => (
            <option key={m} value={m}>
              {MONTH_SHORT[i]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          style={{ ...fs, flex: "1 1 130px", minWidth: 0 }}
        >
          <option value="">All Statuses</option>
          <option value="Overdue">⚠️ Overdue</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.icon} {k}
            </option>
          ))}
        </select>
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{ ...fs, flex: "1 1 150px", minWidth: 0 }}
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={clearAll}
            style={{
              padding: "4px 10px",
              border: "1px solid #fecaca",
              borderRadius: 5,
              background: "#fff1f2",
              cursor: "pointer",
              fontSize: 11,
              color: "#dc2626",
              fontWeight: 700,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ✕ Clear
          </button>
        )}
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {groupedFiltered.length} invoice
          {groupedFiltered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Summary strip when filtered */}
      {hasFilter && groupedFiltered.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 10,
            padding: "8px 14px",
            background: "#f8fafc",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "#64748b" }}>Filtered Total:</span>
          <span style={{ fontWeight: 800, color: "#2563eb" }}>
            ₹{filteredTotal.toLocaleString("en-IN")}
          </span>
          <span style={{ color: "#16a34a", fontWeight: 700 }}>
            ✅ Approved: ₹{filteredApproved.toLocaleString("en-IN")}
          </span>
          <span style={{ color: "#d97706", fontWeight: 700 }}>
            ⏳ Pending: ₹{filteredPending.toLocaleString("en-IN")}
          </span>
          {filteredRejected > 0 && (
            <span style={{ color: "#dc2626", fontWeight: 700 }}>
              ❌ Rejected: ₹{filteredRejected.toLocaleString("en-IN")}
            </span>
          )}
        </div>
      )}

      {groupedFiltered.length === 0 ? (
        <div style={{ color: "#94a3b8", textAlign: "center", padding: 30 }}>
          No invoices found.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                {[
                  "#",
                  "Client",
                  "Job Description",
                  "Month",
                  "Invoice Date",
                  "Inv. No.",
                  "Amount",
                  "Status",
                  "File",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={thS}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedFiltered.map(
                (
                  {
                    key,
                    clientName,
                    invoiceMonth,
                    jobDesc,
                    totalAmt,
                    primaryEntry,
                    invoiceDate,
                    invNums,
                    withFile,
                    hasOverdueGroup,
                  },
                  idx,
                ) => {
                  /* Synthetic plan carries combined job description for the action modal */
                  const syntheticPlan = {
                    ...planMap[primaryEntry.plan_id],
                    client_name: clientName,
                    job_description: jobDesc,
                  };
                  const od = hasOverdueGroup;
                  const st =
                    STATUS_CFG[
                      primaryEntry.status as keyof typeof STATUS_CFG
                    ] || STATUS_CFG.Pending;
                  return (
                    <tr
                      key={key}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: od ? "#fff7ed" : "white",
                      }}
                    >
                      <td style={{ ...tdS, color: "#94a3b8" }}>{idx + 1}</td>
                      <td style={{ ...tdS, fontWeight: 700 }}>{clientName}</td>
                      <td style={{ ...tdS, maxWidth: 200, color: "#475569" }}>
                        {jobDesc || "—"}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        {fmtMonth(invoiceMonth)}
                      </td>
                      <td
                        style={{
                          ...tdS,
                          whiteSpace: "nowrap",
                          color: od ? "#dc2626" : "#374151",
                          fontWeight: od ? 700 : 400,
                        }}
                      >
                        {fmtDate(invoiceDate)} {od ? "⚠️" : ""}
                      </td>
                      <td style={{ ...tdS, color: "#64748b" }}>
                        {invNums || "—"}
                      </td>
                      {/* Amount cell with inline edit button */}
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 700, color: "#16a34a" }}>
                          {fmtMoney(totalAmt)}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() =>
                              onAmountEdit(
                                primaryEntry,
                                syntheticPlan,
                                invoiceMonth,
                              )
                            }
                            title="Edit amount"
                            style={{
                              marginLeft: 6,
                              padding: "1px 5px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 4,
                              background: "#f8fafc",
                              cursor: "pointer",
                              fontSize: 10,
                              color: "#64748b",
                              verticalAlign: "middle",
                            }}
                          >
                            ✏️
                          </button>
                        )}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            background: st.bg,
                            color: st.color,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {st.icon} {primaryEntry.status}
                        </span>
                      </td>
                      <td style={tdS}>
                        {withFile ? (
                          <span style={{ fontSize: 11, color: "#2563eb" }}>
                            📎 {withFile.file_name}
                          </span>
                        ) : (
                          <span style={{ color: "#cbd5e1", fontSize: 11 }}>
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() =>
                            setActive({
                              entry: { ...primaryEntry, amount: totalAmt },
                              plan: syntheticPlan,
                            })
                          }
                          style={{
                            padding: "4px 10px",
                            border: "1px solid #bfdbfe",
                            background: "#eff6ff",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#2563eb",
                          }}
                        >
                          {primaryEntry.status === "Pending" ||
                          primaryEntry.status === "Rejected"
                            ? "📤 Upload"
                            : isAdmin && primaryEntry.status === "Uploaded"
                              ? "✅ Review"
                              : "👁 View"}
                        </button>
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
            {/* Total footer row */}
            {groupedFiltered.length > 1 && (
              <tfoot>
                <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                  <td colSpan={6} style={{ ...tdS, color: "#374151" }}>
                    Total ({groupedFiltered.length} invoices)
                  </td>
                  <td
                    style={{ ...tdS, color: "#16a34a", whiteSpace: "nowrap" }}
                  >
                    ₹{filteredTotal.toLocaleString("en-IN")}
                  </td>
                  <td
                    colSpan={3}
                    style={{ ...tdS, fontSize: 11, color: "#64748b" }}
                  >
                    ✅ ₹{filteredApproved.toLocaleString("en-IN")}
                    &nbsp; ⏳ ₹{filteredPending.toLocaleString("en-IN")}
                    {filteredRejected > 0 && (
                      <>&nbsp; ❌ ₹{filteredRejected.toLocaleString("en-IN")}</>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {active && (
        <InvoiceActionModal
          entry={active.entry}
          plan={active.plan}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setActive(null)}
          onRefresh={() => {
            setActive(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

// ── Main InvoicePage ───────────────────────────────────────────────────────────
export default function InvoicePage({
  profile,
}: {
  profile: { id?: string; role?: string } | null;
}) {
  const [fy, setFy] = useState<string>(getCurrentFY);
  const [tab, setTab] = useState("schedule");
  const [plans, setPlans] = useState<InvoicePlan[]>([]);
  const [entries, setEntries] = useState<InvoiceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [planModal, setPlanModal] = useState<Partial<InvoicePlan> | null>(null);
  const [amtModal, setAmtModal] = useState<AmountModalState | null>(null);
  const [invModal, setInvModal] = useState<InvModalState | null>(null);

  const isAdmin = profile?.role === "admin";
  const fyMonths = useMemo(() => getFYMonths(fy), [fy]);

  const load = async () => {
    setLoading(true);
    const [pd, ed] = await Promise.all([
      apiGet<InvoicePlan[]>("/invoice_plans/"),
      apiGet<InvoiceEntry[]>("/invoice_entries/"),
    ]);
    setPlans(pd || []);
    setEntries(ed || []);
    setLoading(false);
  };
  useEffect(() => {
    const init = async () => {
      await load();
    };
    init();
  }, []);

  const generateEntries = async (plan: InvoicePlan) => {
    // Delete pending entries then regenerate
    const pendingEntries = entries.filter(
      (e) => e.plan_id === plan.id && e.status === "Pending",
    );
    await Promise.all(
      pendingEntries.map((e) => apiDelete(`/invoice_entries/${e.id}/`)),
    );
    const existing = entries
      .filter((e) => e.plan_id === plan.id)
      .map((e) => e.invoice_month);
    const existSet = new Set(existing);
    const applicable = getApplicableMonths(
      plan,
      getAllMonthsInRange(plan.start_month, plan.end_month),
    );
    const toInsert = applicable
      .filter((m) => !existSet.has(m))
      .map((m) => ({
        plan: plan.id,
        client_name: plan.client_name,
        invoice_month: m,
        invoice_date: getInvoiceDate(m, plan.invoice_day),
        amount: plan.base_amount,
        status: "Pending",
      }));
    await Promise.all(toInsert.map((r) => apiPost("/invoice_entries/", r)));
  };

  const handleSavePlan = async (form: PlanForm) => {
    const row = {
      client_name: form.client_name.trim(),
      job_description: form.job_description.trim(),
      periodicity: form.periodicity,
      start_month: form.start_month,
      end_month: form.end_month,
      invoice_day: Number(form.invoice_day),
      base_amount: Number(form.base_amount),
      updated_at: new Date().toISOString(),
    };
    if (form.id) {
      const saved = await apiPatch<InvoicePlan>(
        `/invoice_plans/${form.id}/`,
        row,
      );
      if (saved) await generateEntries(saved);
    } else {
      const maxSNo = plans.reduce(
        (m: number, p: InvoicePlan) => Math.max(m, p.s_no || 0),
        0,
      );
      const saved = await apiPost<InvoicePlan>("/invoice_plans/", {
        ...row,
        s_no: maxSNo + 1,
      });
      if (saved) await generateEntries(saved);
    }
    setPlanModal(null);
    load();
  };

  const handleDeletePlan = async (id: string) => {
    if (!window.confirm("Delete this invoice plan and all its entries?"))
      return;
    const planEntries = entries.filter((e) => e.plan_id === id);
    await Promise.all(
      planEntries.map((e) => apiDelete(`/invoice_entries/${e.id}/`)),
    );
    await apiDelete(`/invoice_plans/${id}/`);
    load();
  };

  const handleAmountSave = async ({
    amount,
    scope,
    month,
  }: AmountSavePayload) => {
    if (!amtModal?.plan?.id) return;
    const { plan } = amtModal;
    const toUpdate = entries.filter(
      (e) =>
        e.plan_id === plan.id &&
        e.status === "Pending" &&
        (scope === "onwards"
          ? e.invoice_month >= month
          : e.invoice_month === month),
    );
    await Promise.all(
      toUpdate.map((e) => apiPatch(`/invoice_entries/${e.id}/`, { amount })),
    );
    setAmtModal(null);
    load();
  };

  // Stats for selected FY
  const fyEntries = useMemo(
    () => entries.filter((e) => fyMonths.includes(e.invoice_month)),
    [entries, fyMonths],
  );
  const stats = useMemo(() => {
    const total = fyEntries.length;
    const approved = fyEntries.filter((e) => e.status === "Approved");
    const pending = fyEntries.filter((e) => e.status === "Pending");
    const overdue = fyEntries.filter(isOverdue);
    const totalVal = fyEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
    const approvedVal = approved.reduce((s, e) => s + Number(e.amount || 0), 0);
    return {
      total,
      approved: approved.length,
      pending: pending.length,
      overdue: overdue.length,
      totalVal,
      approvedVal,
    };
  }, [fyEntries]);

  const boxStyle = {
    background: "#fff",
    borderRadius: 10,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 10,
  };
  const card = (
    color: string,
    n: number | string,
    label: string,
    sub?: string | null,
  ) => (
    <div
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: "8px 14px",
        borderTop: `3px solid ${color}`,
        boxShadow: "0 1px 4px rgba(0,0,0,.07)",
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{n}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 10, color, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>
          🧾 Invoice Tracker
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
            Financial Year:
          </label>
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            style={{
              padding: "5px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              color: "#2563eb",
            }}
          >
            {getFYOptions().map((f) => (
              <option key={f} value={f}>
                FY {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}
      >
        {card("#2563eb", stats.total, "Total Invoices")}
        {card(
          "#16a34a",
          stats.approved,
          "Approved",
          stats.approvedVal
            ? `₹${stats.approvedVal.toLocaleString("en-IN")}`
            : null,
        )}
        {card("#d97706", stats.pending, "Pending Upload")}
        {card("#dc2626", stats.overdue, "Overdue ⚠️")}
        {stats.totalVal > 0 &&
          card(
            "#7c3aed",
            `₹${stats.totalVal.toLocaleString("en-IN")}`,
            "Total Value FY",
          )}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 0,
          borderBottom: "2px solid #e2e8f0",
          background: "#fff",
          borderRadius: "10px 10px 0 0",
          padding: "0 4px",
        }}
      >
        {[
          ["schedule", "📋 Schedule"],
          ["summary", "📊 Summary"],
          ["invoices", "🧾 Invoices"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: "9px 22px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              color: tab === id ? "#2563eb" : "#374151",
              borderBottom:
                tab === id ? "3px solid #2563eb" : "3px solid transparent",
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          ...boxStyle,
          marginTop: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
        }}
      >
        {tab === "schedule" && (
          <ScheduleTab
            plans={plans}
            entries={entries}
            fyMonths={fyMonths}
            loading={loading}
            isAdmin={isAdmin}
            onSavePlan={handleSavePlan}
            onDeletePlan={handleDeletePlan}
            onInvoiceClick={(entry, plan, month) => {
              if (entry) setInvModal({ entry, plan });
              else setAmtModal({ entry: null, plan, month: month ?? "" });
            }}
          />
        )}
        {tab === "summary" && (
          <SummaryTab entries={entries} fyMonths={fyMonths} loading={loading} />
        )}
        {tab === "invoices" && (
          <InvoicesTab
            entries={entries}
            plans={plans}
            fyMonths={fyMonths}
            isAdmin={isAdmin}
            profile={profile}
            onRefresh={load}
            onAmountEdit={(entry, plan, month) =>
              setAmtModal({ entry, plan, month })
            }
          />
        )}
      </div>

      {planModal !== null && (
        <PlanModal
          plan={planModal}
          onSave={handleSavePlan}
          onClose={() => setPlanModal(null)}
        />
      )}
      {amtModal && (
        <AmountEditModal
          entry={amtModal.entry}
          baseAmount={amtModal.plan?.base_amount}
          month={amtModal.month}
          onSave={handleAmountSave}
          onClose={() => setAmtModal(null)}
        />
      )}
      {invModal && (
        <InvoiceActionModal
          entry={invModal.entry}
          plan={invModal.plan}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setInvModal(null)}
          onRefresh={() => {
            setInvModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
