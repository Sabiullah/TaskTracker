import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { thS, tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import KaizenEditRow from "@/components/kaizen/EditRow";
import RejectKaizenModal from "@/components/kaizen/RejectModal";
import {
  BLANK_KAIZEN_ROW as BLANK,
  STATUSES,
  STATUS_CFG,
  dtoToKaizenRow as dtoToRow,
} from "@/utils/kaizen";
import type { KaizenRow, KaizenStatusValue } from "@/types/kaizen";
import type { Profile } from "@/types";
import type {
  KaizenCreate,
  KaizenDto,
  KaizenRejectBody,
  KaizenUpdate,
} from "@/types/api";

const GRID = "1px solid #94a3b8";

const tdS: React.CSSProperties = {
  ...sharedTdS,
  verticalAlign: "top",
  color: "#000",
  background: "#fff",
  border: GRID,
};

const thS2: React.CSSProperties = {
  ...thS,
  color: "#000",
  background: "#fff",
  border: GRID,
  position: "sticky",
  top: 0,
  zIndex: 2,
};

interface KaizenPageProps {
  profile: Profile | null;
  selectedOrg?: string;
}

export default function KaizenPage({
  profile,
  selectedOrg = "",
}: KaizenPageProps) {
  const { isAdminInAny, orgs } = useAuth();
  const isAdmin = isAdminInAny();
  const { clients } = useMasters();

  const [rows, setRows] = useState<KaizenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState<KaizenRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<KaizenRow>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KaizenRow | null>(null);
  const [createOrgUid, setCreateOrgUid] = useState<string>(selectedOrg);

  const [fStatus, setFStatus] = useState<KaizenStatusValue | "">("");
  const [fClient, setFClient] = useState<string>("");
  const [fSearch, setFSearch] = useState<string>("");
  const [showRejected, setShowRejected] = useState<boolean>(false);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ uid: o.uid, name: o.name })),
    [orgs],
  );

  const todayIso = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const dtos = await apiGet<KaizenDto[]>(
        showRejected && isAdmin ? "/kaizens/?include_rejected=1" : "/kaizens/",
      );
      setRows(dtos.map(dtoToRow));
    } finally {
      setLoading(false);
    }
  }, [showRejected, isAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime subscription. Replace/insert/remove on each event.
  useEffect(() => {
    const unsubscribe = ws.subscribe<KaizenDto>("kaizen", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const row = dtoToRow(evt.record);
        setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
      } else if (evt.event === "UPDATE" && evt.record) {
        const row = dtoToRow(evt.record);
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== row.id);
          // Hide rejected from non-admin or when toggle is off.
          if (row.status === "Rejected" && !(isAdmin && showRejected)) {
            return next;
          }
          return [row, ...next];
        });
      } else if (evt.event === "DELETE" && evt.record) {
        const uid = (evt.record as { uid?: string }).uid;
        if (uid) setRows((prev) => prev.filter((r) => r.id !== uid));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [isAdmin, showRejected]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fStatus && r.status !== fStatus) return false;
      if (fClient && r.client_uid !== fClient) return false;
      if (!fSearch) return true;
      const q = fSearch.toLowerCase();
      return (
        r.area.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.takeaway.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q) ||
        r.raised_by.toLowerCase().includes(q)
      );
    });
  }, [rows, fStatus, fClient, fSearch]);

  const myName = profile?.full_name ?? "";

  const startAdd = useCallback(() => {
    setEditId(null);
    setAddRow({ ...BLANK, raised_by: myName, entry_date: todayIso });
    setCreateOrgUid(selectedOrg);
  }, [myName, todayIso, selectedOrg]);

  const cancelAdd = useCallback(() => setAddRow(null), []);

  const startEdit = useCallback((row: KaizenRow) => {
    setAddRow(null);
    setEditId(row.id);
    setEditForm(row);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditForm(BLANK);
  }, []);

  const saveAdd = useCallback(async () => {
    if (!addRow) return;
    setSaving(true);
    try {
      const body: KaizenCreate = {
        client: addRow.client_uid,
        area: addRow.area,
        description: addRow.description,
        takeaway: addRow.takeaway,
        ...(orgOptions.length > 1 && createOrgUid
          ? { org: createOrgUid }
          : {}),
      };
      const saved = await apiPost<KaizenDto>("/kaizens/", body);
      const row = dtoToRow(saved);
      setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
      setAddRow(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [addRow, createOrgUid, orgOptions.length]);

  const saveEdit = useCallback(async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const body: KaizenUpdate = {
        client: editForm.client_uid,
        area: editForm.area,
        description: editForm.description,
        takeaway: editForm.takeaway,
      };
      const saved = await apiPatch<KaizenDto>(`/kaizens/${editId}/`, body);
      const row = dtoToRow(saved);
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      cancelEdit();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [editId, editForm, cancelEdit]);

  const removeRow = useCallback(async (row: KaizenRow) => {
    if (!window.confirm(`Delete this Kaizen entry? "${row.area || row.id}"`))
      return;
    setDeleting(row.id);
    try {
      await apiDelete(`/kaizens/${row.id}/`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  }, []);

  const approve = useCallback(async (row: KaizenRow) => {
    try {
      const saved = await apiPost<KaizenDto>(`/kaizens/${row.id}/approve/`, {});
      const updated = dtoToRow(saved);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Approve failed: ${msg}`);
    }
  }, []);

  const reject = useCallback(
    async (row: KaizenRow, reason: string) => {
      try {
        const body: KaizenRejectBody = { reason };
        await apiPost<KaizenDto>(`/kaizens/${row.id}/reject/`, body);
        // Remove from default list; will reappear under "Show rejected" via WS.
        if (!(isAdmin && showRejected)) {
          setRows((prev) => prev.filter((r) => r.id !== row.id));
        }
        setRejectTarget(null);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Reject failed: ${msg}`);
      }
    },
    [isAdmin, showRejected],
  );

  const canEdit = useCallback(
    (row: KaizenRow) =>
      isAdmin ||
      (row.raised_by_uid === profile?.id && row.status === "Pending"),
    [isAdmin, profile?.id],
  );

  return (
    <div style={{ padding: 16, background: "#fff", color: "#000", minHeight: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          placeholder="Search description / takeaway…"
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          style={{ ...inpS, minWidth: 220, flex: "1 1 220px" }}
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as KaizenStatusValue | "")}
          style={{ ...inpS, width: 140 }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{ ...inpS, width: 180 }}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isAdmin && (
          <label style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(e) => setShowRejected(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Show rejected
          </label>
        )}
        <button
          onClick={startAdd}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          + New Kaizen
        </button>
      </div>

      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 120px)", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", color: "#000" }}>
          <thead>
            <tr style={{ background: "#fff" }}>
              <th style={{ ...thS2, width: 36 }}>#</th>
              <th style={{ ...thS2, width: 130 }}>Raised By</th>
              <th style={{ ...thS2, width: 160 }}>Client</th>
              <th style={{ ...thS2, minWidth: 140 }}>Area</th>
              <th style={{ ...thS2, minWidth: 220 }}>Description</th>
              <th style={{ ...thS2, minWidth: 220 }}>Take Away</th>
              <th style={{ ...thS2, width: 110 }}>Status</th>
              <th style={{ ...thS2, width: 110 }}>Entry Date</th>
              <th style={{ ...thS2, width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addRow && (
              <KaizenEditRow
                form={addRow}
                setForm={
                  setAddRow as React.Dispatch<
                    React.SetStateAction<KaizenRow>
                  >
                }
                onSave={() => {
                  void saveAdd();
                }}
                onCancel={cancelAdd}
                saving={saving}
                isNew
                raisedByDisplay={myName}
                entryDateDisplay={todayIso}
                clients={clients}
                orgOptions={orgOptions}
                orgUid={createOrgUid}
                setOrgUid={setCreateOrgUid}
              />
            )}

            {loading ? (
              <tr>
                <td colSpan={9} style={{ ...tdS, textAlign: "center" }}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 && !addRow ? (
              <tr>
                <td
                  colSpan={9}
                  style={{ ...tdS, textAlign: "center", color: "#94a3b8" }}
                >
                  No Kaizen entries yet.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) =>
                editId === row.id ? (
                  <KaizenEditRow
                    key={row.id}
                    form={editForm}
                    setForm={setEditForm}
                    onSave={() => {
                      void saveEdit();
                    }}
                    onCancel={cancelEdit}
                    saving={saving}
                    isNew={false}
                    raisedByDisplay={row.raised_by}
                    entryDateDisplay={row.entry_date}
                    clients={clients}
                  />
                ) : (
                  <tr key={row.id}>
                    <td style={tdS}>{idx + 1}</td>
                    <td style={tdS}>{row.raised_by}</td>
                    <td style={tdS}>{row.client}</td>
                    <td style={tdS}>{row.area}</td>
                    <td style={{ ...tdS, whiteSpace: "pre-wrap" }}>
                      {row.description}
                    </td>
                    <td style={{ ...tdS, whiteSpace: "pre-wrap" }}>
                      {row.takeaway}
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: STATUS_CFG[row.status].color,
                          background: STATUS_CFG[row.status].bg,
                        }}
                      >
                        {STATUS_CFG[row.status].icon} {row.status}
                      </span>
                      {row.status === "Rejected" && row.rejection_reason && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            marginTop: 4,
                          }}
                          title={row.rejection_reason}
                        >
                          Reason: {row.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td style={tdS}>{row.entry_date}</td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                      {canEdit(row) && (
                        <button
                          onClick={() => startEdit(row)}
                          style={{
                            padding: "4px 8px",
                            background: "#fff",
                            color: "#2563eb",
                            border: "1px solid #bfdbfe",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            marginRight: 4,
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canEdit(row) && (
                        <button
                          onClick={() => {
                            void removeRow(row);
                          }}
                          disabled={deleting === row.id}
                          style={{
                            padding: "4px 8px",
                            background: "#fff",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            marginRight: 4,
                          }}
                        >
                          {deleting === row.id ? "…" : "Delete"}
                        </button>
                      )}
                      {isAdmin && row.status === "Pending" && (
                        <>
                          <button
                            onClick={() => {
                              void approve(row);
                            }}
                            style={{
                              padding: "4px 8px",
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 5,
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 700,
                              marginRight: 4,
                            }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => setRejectTarget(row)}
                            style={{
                              padding: "4px 8px",
                              background: "#fff",
                              color: "#dc2626",
                              border: "1px solid #fecaca",
                              borderRadius: 5,
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            ✕ Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <RejectKaizenModal
          entryLabel={`${rejectTarget.client} — ${rejectTarget.area || "(no area)"}`}
          onSubmit={(reason) => reject(rejectTarget, reason)}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}
