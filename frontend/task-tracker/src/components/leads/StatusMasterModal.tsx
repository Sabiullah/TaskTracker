import { useState } from "react";
import { ApiError, apiDelete, apiPatch, apiPost } from "@/lib/api";
import type {
  LeadStatusCreate,
  LeadStatusDto,
  LeadStatusUpdate,
} from "@/types/api";
import { PRESET_COLORS, hexBg } from "@/utils/leads";
import type { LeadStatusRecord } from "@/types";

export interface StatusMasterModalProps {
  statuses: LeadStatusRecord[];
  onClose: () => void;
  onRefresh: () => void;
}

export default function StatusMasterModal({
  statuses,
  onClose,
  onRefresh,
}: StatusMasterModalProps) {
  const list = statuses.map((s) => ({ ...s }));
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const addStatus = async (): Promise<void> => {
    if (!newName.trim()) {
      alert("Enter a status name");
      return;
    }
    if (list.some((s) => s.name.toLowerCase() === newName.trim().toLowerCase())) {
      alert("Status already exists");
      return;
    }
    setSaving(true);
    try {
      const maxOrder = list.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
      const body: LeadStatusCreate = {
        name: newName.trim(),
        color: newColor,
        sort_order: maxOrder + 1,
      };
      await apiPost<LeadStatusDto>("/lead_statuses/", body);
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Error: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s: LeadStatusRecord) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditColor("");
  };

  const saveEdit = async (s: LeadStatusRecord): Promise<void> => {
    if (!editName.trim()) {
      alert("Name required");
      return;
    }
    setSaving(true);
    try {
      const body: LeadStatusUpdate = {
        name: editName.trim(),
        color: editColor,
      };
      await apiPatch<LeadStatusDto>(`/lead_statuses/${s.id}/`, body);
      cancelEdit();
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Error: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteStatus = async (s: LeadStatusRecord): Promise<void> => {
    if (
      !window.confirm(
        `Delete status "${s.name}"? Leads with this status won't be affected.`,
      )
    )
      return;
    try {
      await apiDelete(`/lead_statuses/${s.id}/`);
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  const moveOrder = async (
    s: LeadStatusRecord,
    dir: number,
  ): Promise<void> => {
    const idx = list.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const swap = list[swapIdx];
    try {
      await Promise.all([
        apiPatch<LeadStatusDto>(`/lead_statuses/${s.id}/`, {
          sort_order: swap.sort_order ?? 0,
        }),
        apiPatch<LeadStatusDto>(`/lead_statuses/${swap.id}/`, {
          sort_order: s.sort_order ?? 0,
        }),
      ]);
      onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Reorder failed: ${msg}`);
    }
  };

  const inp: React.CSSProperties = {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1200,
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
          maxWidth: 520,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            ⚙️ Lead Status Master
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

        <div style={{ marginBottom: 20 }}>
          {statuses.map((s, idx) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1.5px solid #e2e8f0",
                marginBottom: 6,
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: s.color,
                  flexShrink: 0,
                }}
              />

              {editId === s.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ ...inp, flex: 1, padding: "4px 8px" }}
                  />
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {PRESET_COLORS.map((c: string) => (
                      <div
                        key={c}
                        onClick={() => setEditColor(c)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: c,
                          cursor: "pointer",
                          outline: editColor === c ? `3px solid ${c}` : "none",
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => saveEdit(s)}
                    disabled={saving}
                    style={{
                      padding: "4px 10px",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {saving ? "…" : "✓"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    style={{
                      padding: "4px 10px",
                      background: "#f1f5f9",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                    {s.name}
                  </span>
                  <span
                    style={{
                      background: hexBg(s.color),
                      color: s.color,
                      padding: "2px 9px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {s.name}
                  </span>
                  <button
                    onClick={() => moveOrder(s, -1)}
                    disabled={idx === 0}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                      opacity: idx === 0 ? 0.3 : 1,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveOrder(s, 1)}
                    disabled={idx === statuses.length - 1}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                      opacity: idx === statuses.length - 1 ? 0.3 : 1,
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => startEdit(s)}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff",
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteStatus(s)}
                    style={{
                      padding: "3px 7px",
                      border: "1px solid #fecaca",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 11,
                      background: "#fff1f2",
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          {statuses.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              No statuses yet. Add one below.
            </div>
          )}
        </div>

        <div style={{ borderTop: "2px solid #f1f5f9", paddingTop: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              marginBottom: 8,
            }}
          >
            Add New Status
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Status name…"
              style={{ ...inp, flex: 1, minWidth: 120 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addStatus();
              }}
            />
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {PRESET_COLORS.map((c: string) => (
                <div
                  key={c}
                  onClick={() => setNewColor(c)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    outline:
                      newColor === c
                        ? `3px solid ${c}`
                        : "2px solid transparent",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            <button
              onClick={addStatus}
              disabled={saving}
              style={{
                padding: "7px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {saving ? "…" : "+ Add"}
            </button>
          </div>
          {newColor && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Preview:</span>
              <span
                style={{
                  background: hexBg(newColor),
                  color: newColor,
                  padding: "2px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {newName || "Status Name"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
