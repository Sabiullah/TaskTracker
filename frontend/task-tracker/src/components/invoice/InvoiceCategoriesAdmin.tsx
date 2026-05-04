import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import type { InvoiceCategoryCreate } from "@/types/api";

interface Props {
  defaultOrgUid: string;
  onClose: () => void;
}

export default function InvoiceCategoriesAdmin({ defaultOrgUid, onClose }: Props) {
  const { categories, reload } = useInvoiceCategories();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#dbeafe");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body: InvoiceCategoryCreate = { name: name.trim(), org: defaultOrgUid, color };
      await apiPost("/invoice_categories/", body);
      setName("");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await apiPatch(`/invoice_categories/${id}/`, { is_active });
    await reload();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    try {
      await apiDelete(`/invoice_categories/${id}/`);
      await reload();
    } catch (e) {
      alert(`Cannot delete — category may be in use. (${(e as Error).message})`);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🏷️ Invoice Categories</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" style={{ flex: 1, padding: "5px 8px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, padding: 0, border: "1.5px solid #e2e8f0", borderRadius: 6 }} />
          <button onClick={add} disabled={busy || !name.trim()} style={{ padding: "5px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            Add
          </button>
        </div>
        {categories.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid #f1f5f9", opacity: c.is_active ? 1 : 0.5 }}>
            <span style={{ width: 14, height: 14, background: c.color || "#dbeafe", borderRadius: 3 }} />
            <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
            <button onClick={() => toggleActive(c.id, !c.is_active)} style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #cbd5e1", borderRadius: 4, background: "#fff", cursor: "pointer" }}>
              {c.is_active ? "Deactivate" : "Activate"}
            </button>
            <button onClick={() => remove(c.id)} style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 4, background: "#fff", cursor: "pointer" }}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
