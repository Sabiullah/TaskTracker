import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { fmtDate } from "@/utils/date";
import { thS, tdS } from "@/utils/tableStyles";
import type { Profile } from "@/types";
import type {
  NoticeCreate,
  NoticeDto,
  NoticeStatusValue,
  NoticeUpdate,
} from "@/types/api";
import { useMasters } from "@/hooks/useMasters";
import {
  BLANK_NOTICE_ROW as BLANK,
  STATUSES,
  STATUS_CFG,
  dtoToNoticeRow as dtoToRow,
} from "@/utils/notice";
import type { NoticeRow } from "@/types/notice";
import EditRow from "@/components/notice/EditRow";

import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

const TODAY = new Date().toISOString().slice(0, 10);

interface NoticePageProps {
  profile: Profile | null;
  /** Header-org filter. Forwarded to POST/PATCH bodies so the backend's
   *  ``resolve_create_org`` doesn't 400 with "you belong to multiple orgs"
   *  for users with 2+ memberships. */
  selectedOrg?: string;
}

export default function NoticePage({
  profile: _profile,
  selectedOrg = "",
}: NoticePageProps) {
  const { isManagerInAny } = useAuth();
  const { canView, canEdit } = usePermissions(selectedOrg || undefined);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState<NoticeRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<NoticeRow>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [fStatus, setFStatus] = useState<NoticeStatusValue | "">("");
  const [fClient, setFClient] = useState("");
  const [activeTab, setActiveTab] = useState<"open" | "completed">("open");

  const isAdmin = isManagerInAny();

  const canViewOpen = canView("notice.open");
  const canViewCompleted = canView("notice.completed");
  const canEditNotice = canEdit("notice");

  useEffect(() => {
    if (activeTab === "open" && !canViewOpen && canViewCompleted) {
      setActiveTab("completed");
    } else if (activeTab === "completed" && !canViewCompleted && canViewOpen) {
      setActiveTab("open");
    }
  }, [activeTab, canViewOpen, canViewCompleted]);

  const { clients: clientMasters } = useMasters();
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const dtos = await apiGet<NoticeDto[]>("/notices/");
      setNotices(dtos.map(dtoToRow).sort((a, b) => a.serialNo - b.serialNo));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<NoticeDto>("notices", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const clients = useMemo(
    () => [...new Set(notices.map((n) => n.client_name).filter(Boolean))].sort(),
    [notices],
  );

  const tabFiltered = useMemo(
    () =>
      notices.filter((n) =>
        activeTab === "completed"
          ? n.status === "Completed"
          : n.status !== "Completed",
      ),
    [notices, activeTab],
  );

  const tabCounts = useMemo(
    () => ({
      open: notices.filter((n) => n.status !== "Completed").length,
      completed: notices.filter((n) => n.status === "Completed").length,
    }),
    [notices],
  );

  const filtered = useMemo(
    () =>
      tabFiltered
        .filter((n) => !fStatus || n.status === fStatus)
        .filter((n) => !fClient || n.client_name === fClient),
    [tabFiltered, fStatus, fClient],
  );

  const stats = useMemo(() => {
    const overdue = notices.filter(
      (n) =>
        n.next_target_date &&
        n.next_target_date < TODAY &&
        n.status !== "Completed",
    );
    return {
      total: notices.length,
      Open: notices.filter((n) => n.status === "Open").length,
      Replied: notices.filter((n) => n.status === "Replied").length,
      Appealed: notices.filter((n) => n.status === "Appealed").length,
      Completed: notices.filter((n) => n.status === "Completed").length,
      overdue: overdue.length,
    };
  }, [notices]);

  const validateForm = (form: NoticeRow): boolean => {
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

  const currentFY = (): string => {
    const d = new Date();
    const y = d.getFullYear();
    const start = d.getMonth() >= 3 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  };

  const handleSave = async (
    form: NoticeRow,
    id: string | null,
  ): Promise<void> => {
    if (!validateForm(form)) return;
    setSaving(true);
    try {
      const clientName = form.client_name.trim();
      // The notice tracker accepts any client name, not only registered
      // clients. Store the typed name verbatim; opportunistically link the
      // client FK when the name matches a registered master (``?? null`` so
      // editing to a non-registered name clears a stale link).
      const clientUid = clientUidByName[clientName] ?? null;
      // Multi-org users MUST send `org` — backend's ``resolve_create_org``
      // 400s with "you belong to multiple organisations" otherwise. Prefer
      // the header-selected org; fall back to the client master's primary
      // org when "All Orgs" is active so a matched client still resolves.
      const clientMaster = clientMasters.find((c) => c.id === clientUid);
      const clientOrgUid =
        clientMaster?.orgs && clientMaster.orgs.length
          ? clientMaster.orgs[0]
          : clientMaster?.org ?? null;
      const orgUid = selectedOrg || clientOrgUid || undefined;
      const body: NoticeCreate = {
        client: clientUid,
        client_name: clientName,
        dispute_nature: form.dispute_nature.trim(),
        fy: form.fy || currentFY(),
        status: form.status,
        remarks: form.remarks?.trim() || undefined,
        received_date: form.received_date || undefined,
        replied_date: form.replied_date || undefined,
        next_target_date: form.next_target_date || undefined,
        ...(orgUid ? { org: orgUid } : {}),
      };
      if (id) {
        const patch: NoticeUpdate = body;
        await apiPatch<NoticeDto>(`/notices/${id}/`, patch);
      } else {
        await apiPost<NoticeDto>("/notices/", body);
      }
      setAddRow(null);
      setEditId(null);
      setEditForm(BLANK);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this notice record?")) return;
    setDeleting(id);
    try {
      await apiDelete(`/notices/${id}/`);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  };

  const startEdit = (n: NoticeRow): void => {
    setEditId(n.id);
    setEditForm({ ...n });
    setAddRow(null);
  };
  const cancelAll = (): void => {
    setEditId(null);
    setEditForm(BLANK);
    setAddRow(null);
  };
  const clearFilters = (): void => {
    setFStatus("");
    setFClient("");
  };
  const hasFilter = fStatus || fClient;

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center",
  });

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div className="page-title">📋 Notice Tracker</div>
        {isAdmin && canEditNotice && !addRow && !editId && (
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
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
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
            style={{ ...cardS(STATUS_CFG[s].color), cursor: "pointer" }}
            onClick={() => {
              setActiveTab(s === "Completed" ? "completed" : "open");
              setFStatus(fStatus === s ? "" : s);
            }}
            title={`Filter: ${s}`}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: STATUS_CFG[s].color,
              }}
            >
              {stats[s]}
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
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
              {stats.overdue}
            </div>
            <div style={{ fontSize: 10, color: "#dc2626" }}>Overdue ⚠️</div>
          </div>
        )}
      </div>

      {/* Tabs: Open / Completed */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 10,
          borderBottom: "1.5px solid #e2e8f0",
        }}
      >
        {(
          [
            ["open", "Open", tabCounts.open, "#2563eb"],
            ["completed", "Completed", tabCounts.completed, "#16a34a"],
          ] as const
        )
          .filter(([key]) =>
            key === "open" ? canViewOpen : canViewCompleted,
          )
          .map(([key, label, count, color]) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                setFStatus("");
              }}
              style={{
                padding: "8px 16px",
                border: "none",
                borderBottom: active
                  ? `2.5px solid ${color}`
                  : "2.5px solid transparent",
                marginBottom: -1.5,
                background: "transparent",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                color: active ? color : "#64748b",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {label}
              <span
                style={{
                  background: active ? color : "#e2e8f0",
                  color: active ? "#fff" : "#64748b",
                  padding: "1px 8px",
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
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
          onChange={(e) =>
            setFStatus(e.target.value as NoticeStatusValue | "")
          }
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
          {STATUSES.filter((s) =>
            activeTab === "completed" ? s === "Completed" : s !== "Completed",
          ).map((s) => (
            <option key={s} value={s}>
              {STATUS_CFG[s].icon} {s}
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
          <div
            style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}
          >
            Loading…
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, minWidth: 140 }}>Client</th>
                <th style={{ ...thS, minWidth: 200 }}>Dispute Nature</th>
                <th style={{ ...thS, width: 130 }}>Received Date</th>
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
                    {isAdmin &&
                      canEditNotice &&
                      !hasFilter &&
                      "Click + Add Notice to begin."}
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
                        onSave={() => {
                          void handleSave(editForm, n.id);
                        }}
                        onCancel={cancelAll}
                        saving={saving}
                        isNew={false}
                      />
                    );
                  }
                  const cfg = STATUS_CFG[n.status];
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
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        {fmtDate(n.received_date)}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        {fmtDate(n.replied_date)}
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
                      <td style={tdS}>
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
                            disabled={!canEditNotice}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 5,
                              cursor: canEditNotice ? "pointer" : "not-allowed",
                              background: "#f8fafc",
                              fontSize: 12,
                              marginRight: 4,
                              opacity: canEditNotice ? 1 : 0.5,
                            }}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => {
                              void handleDelete(n.id);
                            }}
                            disabled={!canEditNotice || deleting === n.id}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #fecaca",
                              borderRadius: 5,
                              cursor: canEditNotice ? "pointer" : "not-allowed",
                              background: "#fff1f2",
                              fontSize: 12,
                              opacity:
                                !canEditNotice || deleting === n.id ? 0.5 : 1,
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

              {addRow && (
                <EditRow
                  form={addRow}
                  setForm={
                    setAddRow as unknown as Dispatch<SetStateAction<NoticeRow>>
                  }
                  onSave={() => {
                    void handleSave(addRow, null);
                  }}
                  onCancel={cancelAll}
                  saving={saving}
                  isNew={true}
                />
              )}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin && canEditNotice && !addRow && !editId && notices.length > 0 && (
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
