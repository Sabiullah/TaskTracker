import type { CSSProperties } from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type {
  NoticeStatus,
  NoticeForm,
  Notice,
  StatusCfg,
  StatsKey,
} from "@/types/notice";

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUSES = ["Open", "Replied", "Appealed", "Completed"];

const STATUS_CFG: Record<NoticeStatus, StatusCfg> = {
  Open: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
  Replied: { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Appealed: { color: "#7c3aed", bg: "#f5f3ff", icon: "🟣" },
  Completed: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
};

const FY_OPTIONS = (() => {
  const now = new Date();
  const base = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [-4, -3, -2, -1, 0, 1, 2].map((off) => {
    const y = base + off;
    return `${y}-${String(y + 1).slice(-2)}`;
  });
})();

const TODAY = new Date().toISOString().slice(0, 10);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
    : "—";

const thS: CSSProperties = {
  padding: "7px 10px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
const tdS: CSSProperties = {
  padding: "7px 10px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
const inpS: CSSProperties = {
  padding: "5px 7px",
  border: "1.5px solid #cbd5e1",
  borderRadius: 5,
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#fff",
};

const BLANK = {
  client_name: "",
  dispute_nature: "",
  fy: "",
  notice_replied_date: "",
  next_target_date: "",
  remarks: "",
  status: "Open",
};

// ── Inline editable row ────────────────────────────────────────────────────────
function EditRow({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  isNew,
}: {
  form: NoticeForm;
  setForm: React.Dispatch<React.SetStateAction<NoticeForm>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}) {
  return (
    <tr
      style={{
        background: isNew ? "#f0f9ff" : "#fffbeb",
        borderBottom: "2px solid #2563eb",
      }}
    >
      {/* # placeholder */}
      <td style={{ ...tdS, color: "#94a3b8", width: 36 }}>
        {isNew ? (
          <span style={{ fontSize: 11, color: "#2563eb" }}>New</span>
        ) : (
          "✏️"
        )}
      </td>
      {/* Client */}
      <td style={{ ...tdS, minWidth: 140 }}>
        <input
          style={inpS}
          value={form.client_name}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({ ...f, client_name: e.target.value }))
          }
          placeholder="Client name *"
          autoFocus={isNew}
        />
      </td>
      {/* Dispute Nature */}
      <td style={{ ...tdS, minWidth: 180 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.dispute_nature}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({
              ...f,
              dispute_nature: e.target.value,
            }))
          }
          placeholder="Nature of dispute *"
        />
      </td>
      {/* FY */}
      <td style={{ ...tdS, width: 110 }}>
        <select
          style={inpS}
          value={form.fy}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({ ...f, fy: e.target.value }))
          }
        >
          <option value="">Select FY</option>
          {FY_OPTIONS.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
      </td>
      {/* Notice Replied Date */}
      <td style={{ ...tdS, width: 130 }}>
        <input
          type="date"
          style={inpS}
          value={form.notice_replied_date}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({
              ...f,
              notice_replied_date: e.target.value,
            }))
          }
        />
      </td>
      {/* Next Target Date */}
      <td style={{ ...tdS, width: 130 }}>
        <input
          type="date"
          style={inpS}
          value={form.next_target_date}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({
              ...f,
              next_target_date: e.target.value,
            }))
          }
        />
      </td>
      {/* Remarks */}
      <td style={{ ...tdS, minWidth: 160 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.remarks}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({ ...f, remarks: e.target.value }))
          }
          placeholder="Remarks…"
        />
      </td>
      {/* Status */}
      <td style={{ ...tdS, width: 110 }}>
        <select
          style={inpS}
          value={form.status}
          onChange={(e) =>
            setForm((f: NoticeForm) => ({ ...f, status: e.target.value }))
          }
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      {/* Actions */}
      <td style={{ ...tdS, whiteSpace: "nowrap", width: 90 }}>
        <button
          onClick={onSave}
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
          onClick={onCancel}
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
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function NoticePage({
  profile,
}: {
  profile: Record<string, unknown> | null;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState<NoticeForm | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<NoticeForm>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filters
  const [fStatus, setFStatus] = useState("");
  const [fClient, setFClient] = useState("");
  const [fFY, setFFY] = useState("");

  const isAdmin = profile?.role === "admin" || profile?.role === "manager";

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const data = await apiGet<Notice[]>("/notices/");
    setNotices(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const clients = useMemo(
    () =>
      [...new Set(notices.map((n) => n.client_name).filter(Boolean))].sort(),
    [notices],
  );

  const filtered = useMemo(
    () =>
      notices
        .filter((n) => !fStatus || n.status === fStatus)
        .filter((n) => !fClient || n.client_name === fClient)
        .filter((n) => !fFY || n.fy === fFY),
    [notices, fStatus, fClient, fFY],
  );

  // Stats
  const stats = useMemo(() => {
    const overdue = notices.filter(
      (n) =>
        n.next_target_date &&
        n.next_target_date < TODAY &&
        n.status !== "Completed",
    );
    return {
      total: notices.length,
      open: notices.filter((n) => n.status === "Open").length,
      replied: notices.filter((n) => n.status === "Replied").length,
      appealed: notices.filter((n) => n.status === "Appealed").length,
      completed: notices.filter((n) => n.status === "Completed").length,
      overdue: overdue.length,
    };
  }, [notices]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const validateForm = (form: NoticeForm) => {
    if (!form.client_name?.trim()) {
      alert("Client name is required");
      return false;
    }
    if (!form.dispute_nature?.trim()) {
      alert("Dispute nature is required");
      return false;
    }
    return true;
  };

  const handleSave = async (form: NoticeForm, id: string | null) => {
    if (!validateForm(form)) return;
    setSaving(true);
    const row = {
      client_name: form.client_name.trim(),
      dispute_nature: form.dispute_nature.trim(),
      fy: form.fy || null,
      notice_replied_date: form.notice_replied_date || null,
      next_target_date: form.next_target_date || null,
      remarks: form.remarks?.trim() || null,
      status: form.status || "Open",
      updated_at: new Date().toISOString(),
    };
    if (id) {
      await apiPatch(`/notices/${id}/`, row);
    } else {
      const maxSNo = notices.reduce((m, n) => Math.max(m, n.s_no || 0), 0);
      await apiPost("/notices/", { ...row, s_no: maxSNo + 1 });
    }
    setSaving(false);
    setAddRow(null);
    setEditId(null);
    setEditForm({ ...BLANK });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this notice record?")) return;
    setDeleting(id);
    await apiDelete(`/notices/${id}/`);
    setDeleting(null);
    load();
  };

  const startEdit = (n: Notice) => {
    setEditId(n.id);
    setEditForm({ ...n });
    setAddRow(null);
  };
  const cancelAll = () => {
    setEditId(null);
    setEditForm({ ...BLANK });
    setAddRow(null);
  };
  const clearFilters = () => {
    setFStatus("");
    setFClient("");
    setFFY("");
  };
  const hasFilter = fStatus || fClient || fFY;

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center" as const,
  });

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>
          📋 Notice Tracker
        </div>
        {isAdmin && !addRow && !editId && (
          <button
            onClick={() => {
              setAddRow({ ...BLANK });
              setEditId(null);
            }}
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
            + Add Notice
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        <div style={cardS("#64748b")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#64748b" }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>Total</div>
        </div>
        {STATUSES.map((s) => (
          <div
            key={s}
            style={{
              ...cardS((STATUS_CFG as Record<string, StatusCfg>)[s].color),
              cursor: "pointer",
            }}
            onClick={() => setFStatus(fStatus === s ? "" : s)}
            title={`Filter: ${s}`}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: (STATUS_CFG as Record<string, StatusCfg>)[s].color,
              }}
            >
              {(stats as Record<StatsKey, number>)[s.toLowerCase() as StatsKey]}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{s}</div>
          </div>
        ))}
        {stats.overdue > 0 && (
          <div
            style={{
              ...cardS("#dc2626"),
              background: "#fef2f2",
              cursor: "pointer",
            }}
            onClick={() => {
              setFStatus("");
              setFClient("");
              setFFY("");
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
              {stats.overdue}
            </div>
            <div style={{ fontSize: 10, color: "#dc2626" }}>Overdue ⚠️</div>
          </div>
        )}
      </div>

      {/* Filters — single row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "nowrap",
          background: "#fff",
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,.05)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#64748b",
            whiteSpace: "nowrap",
          }}
        >
          🔍 Filter:
        </span>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          style={{
            flex: "1 1 120px",
            padding: "5px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 5,
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {(STATUS_CFG as Record<string, StatusCfg>)[s].icon} {s}
            </option>
          ))}
        </select>
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{
            flex: "1 1 150px",
            padding: "5px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 5,
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={fFY}
          onChange={(e) => setFFY(e.target.value)}
          style={{
            flex: "1 1 120px",
            padding: "5px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 5,
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <option value="">All FYs</option>
          {FY_OPTIONS.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={clearFilters}
            style={{
              padding: "5px 10px",
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
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          overflowX: "auto",
        }}
      >
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
            Loading…
          </div>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, minWidth: 140 }}>Client</th>
                <th style={{ ...thS, minWidth: 200 }}>Dispute Nature</th>
                <th style={{ ...thS, width: 90 }}>FY</th>
                <th style={{ ...thS, width: 120 }}>Replied Date</th>
                <th style={{ ...thS, width: 120 }}>Next Target</th>
                <th style={{ ...thS, minWidth: 160 }}>Remarks</th>
                <th style={{ ...thS, width: 110 }}>Status</th>
                {isAdmin && <th style={{ ...thS, width: 90 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !addRow ? (
                <tr>
                  <td
                    colSpan={isAdmin ? 9 : 8}
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8",
                      fontSize: 14,
                    }}
                  >
                    No notices found.{" "}
                    {isAdmin && !hasFilter && "Click + Add Notice to begin."}
                  </td>
                </tr>
              ) : (
                filtered.map((n, idx) => {
                  if (editId === n.id) {
                    return (
                      <EditRow
                        key={n.id}
                        form={editForm}
                        setForm={setEditForm}
                        onSave={() => handleSave(editForm, n.id)}
                        onCancel={cancelAll}
                        saving={saving}
                        isNew={false}
                      />
                    );
                  }
                  const cfg: StatusCfg =
                    (STATUS_CFG as Record<string, StatusCfg>)[n.status] ||
                    STATUS_CFG.Open;
                  const isOverdue =
                    n.next_target_date &&
                    n.next_target_date < TODAY &&
                    n.status !== "Completed";
                  return (
                    <tr
                      key={n.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: isOverdue ? "#fff7ed" : "white",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = isOverdue
                          ? "#fef3c7"
                          : "#f8fafc")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = isOverdue
                          ? "#fff7ed"
                          : "white")
                      }
                    >
                      <td style={{ ...tdS, color: "#94a3b8", width: 36 }}>
                        {idx + 1}
                      </td>
                      <td style={{ ...tdS, fontWeight: 700 }}>
                        {n.client_name}
                      </td>
                      <td style={{ ...tdS, color: "#475569" }}>
                        <div style={{ maxWidth: 260, lineHeight: 1.5 }}>
                          {n.dispute_nature}
                        </div>
                      </td>
                      <td style={{ ...tdS, color: "#64748b", fontWeight: 600 }}>
                        {n.fy ? `FY ${n.fy}` : "—"}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        {fmtDate(n.notice_replied_date)}
                      </td>
                      <td
                        style={{
                          ...tdS,
                          whiteSpace: "nowrap",
                          color: isOverdue ? "#dc2626" : "#374151",
                          fontWeight: isOverdue ? 700 : 400,
                        }}
                      >
                        {fmtDate(n.next_target_date)} {isOverdue ? "⚠️" : ""}
                      </td>
                      <td style={{ ...tdS, color: "#475569" }}>
                        <div style={{ maxWidth: 220, lineHeight: 1.5 }}>
                          {n.remarks || "—"}
                        </div>
                      </td>
                      <td style={{ ...tdS }}>
                        <span
                          style={{
                            background: cfg.bg,
                            color: cfg.color,
                            padding: "3px 10px",
                            borderRadius: 5,
                            fontSize: 11,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cfg.icon} {n.status}
                        </span>
                      </td>
                      {isAdmin && (
                        <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => startEdit(n)}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: "#f8fafc",
                              fontSize: 12,
                              marginRight: 4,
                            }}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(n.id)}
                            disabled={deleting === n.id}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #fecaca",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: "#fff1f2",
                              fontSize: 12,
                              opacity: deleting === n.id ? 0.5 : 1,
                            }}
                            title="Delete"
                          >
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}

              {/* New row appended at bottom */}
              {addRow && (
                <EditRow
                  form={addRow}
                  setForm={
                    setAddRow as React.Dispatch<
                      React.SetStateAction<NoticeForm>
                    >
                  }
                  onSave={() => handleSave(addRow, null)}
                  onCancel={cancelAll}
                  saving={saving}
                  isNew={true}
                />
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom add button if there are already records */}
      {isAdmin && !addRow && !editId && notices.length > 0 && (
        <div style={{ marginTop: 10, textAlign: "center" }}>
          <button
            onClick={() => {
              setAddRow({ ...BLANK });
              setEditId(null);
            }}
            style={{
              padding: "6px 20px",
              background: "#f0f9ff",
              color: "#2563eb",
              border: "1.5px dashed #93c5fd",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            + Add Another Notice
          </button>
        </div>
      )}
    </div>
  );
}
