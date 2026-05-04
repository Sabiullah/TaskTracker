import { useEffect, useState } from "react";
import { formatMonthLabel as fmtMonth } from "@/utils/date";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import CategoryOwnerAllocation, {
  type CategoryOwnerAllocationCategory,
} from "./CategoryOwnerAllocation";
import type { InvoiceEntry, InvoiceProjectStatus } from "@/types";

export interface AmountEditModalProps {
  entry: Partial<InvoiceEntry> | null;
  baseAmount: number | null;
  month: string;
  onSave: (payload: {
    amount: number;
    scope: string;
    month: string;
    project_status?: InvoiceProjectStatus;
    categories?: CategoryOwnerAllocationCategory[];
  }) => Promise<void>;
  onClose: () => void;
}

export default function AmountEditModal({
  entry,
  baseAmount,
  month,
  onSave,
  onClose,
}: AmountEditModalProps) {
  const [amount, setAmount] = useState<string | number>(
    entry?.amount ?? baseAmount ?? "",
  );
  const [scope, setScope] = useState("onwards");
  const [saving, setSaving] = useState(false);

  const [projectStatus, setProjectStatus] = useState<InvoiceProjectStatus>(
    (entry?.project_status as InvoiceProjectStatus) ?? "Projected",
  );
  const [cats, setCats] = useState<CategoryOwnerAllocationCategory[]>(
    (entry?.categories ?? []).map((c) => ({
      category_uid: c.category_uid,
      category_name: c.category_name,
      color: c.color,
      contribution_pct: c.contribution_pct,
      owners: (c.owners ?? []).map((o) => ({
        user_uid: o.user_uid,
        user_name: o.user_name,
        contribution_pct: o.contribution_pct,
      })),
    })),
  );
  const [showAttribution, setShowAttribution] = useState(false);
  const { categories } = useInvoiceCategories();
  const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    (async () => {
      interface ProfileItem {
        uid: string;
        full_name?: string;
        username?: string;
        is_active?: boolean;
      }
      const profiles = await apiGet<ProfileItem[]>("/profiles/");
      setOwners(
        profiles
          .filter((p) => p.is_active !== false)
          .map((p) => ({
            id: p.uid,
            label: p.full_name || p.username || p.uid,
          })),
      );
    })().catch(() => setOwners([]));
  }, []);

  const save = async () => {
    if (amount === "" || isNaN(Number(amount)))
      return alert("Enter a valid amount");
    const sum = (xs: { contribution_pct: number }[]) =>
      xs.reduce((s, x) => s + (x.contribution_pct || 0), 0);
    const pctOk = (total: number, allowEmpty: boolean) =>
      (allowEmpty && total === 0) || Math.abs(total - 100) < 0.005;
    if (!pctOk(sum(cats), true))
      return alert("Categories must sum to 100% (or be empty).");
    for (const c of cats) {
      if (!pctOk(sum(c.owners), true))
        return alert(
          `Owners under "${c.category_name}" must sum to 100% (or be empty).`,
        );
    }
    setSaving(true);
    await onSave({
      amount: Number(amount),
      scope,
      month,
      project_status: projectStatus,
      categories: cats,
    });
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
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dm-modal-card"
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
            onChange={(e) => setAmount(e.target.value)}
            min={0}
            autoFocus
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1.5px solid #2563eb",
              borderRadius: 6,
              fontSize: 14,
              boxSizing: "border-box",
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
                onChange={() => setScope(v)}
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
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setShowAttribution((s) => !s)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#2563eb",
              fontWeight: 700,
              fontSize: 12,
              padding: 0,
            }}
          >
            {showAttribution ? "▾" : "▸"} Attribution
          </button>
          {showAttribution && (
            <div style={{ marginTop: 8 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Project Status
              </label>
              <select
                value={projectStatus}
                onChange={(e) =>
                  setProjectStatus(e.target.value as InvoiceProjectStatus)
                }
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  marginBottom: 10,
                }}
              >
                <option value="Projected">Projected</option>
                <option value="Confirmed">Confirmed</option>
              </select>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Categories &amp; Owners
              </label>
              <CategoryOwnerAllocation
                categoryOptions={categories.map((c) => ({
                  id: c.id,
                  label: c.name,
                  color: c.color,
                }))}
                ownerOptions={owners}
                value={cats}
                onChange={setCats}
              />
            </div>
          )}
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
