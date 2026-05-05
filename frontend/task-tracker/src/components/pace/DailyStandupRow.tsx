import { useEffect, useState } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupRowProps {
  row: OperationalStandupRosterRow;
  isAdmin: boolean;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string) => Promise<void>;
  onReview: (rowUid: string) => Promise<void>;
}

export function DailyStandupRow({
  row,
  isAdmin,
  onSave,
  onApprove,
  onReview,
}: DailyStandupRowProps) {
  const e = row.entry;
  const [breakthroughType, setBreakthroughType] = useState<BreakthroughTypeValue>(
    e?.breakthrough_type ?? "",
  );
  const [priorities, setPriorities] = useState(e?.priorities ?? "");
  const [collab, setCollab] = useState(e?.collaboration_need ?? "");
  const [remarks, setRemarks] = useState(e?.remarks ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  // Auto-clear "Saved ✓" indicator after 1.5s.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(t);
  }, [justSaved]);

  const isPlaceholder = e === null;
  const locked = !row.can_edit;

  const startEdit = () => {
    setBreakthroughType(e?.breakthrough_type ?? "");
    setPriorities(e?.priorities ?? "");
    setCollab(e?.collaboration_need ?? "");
    setRemarks(e?.remarks ?? "");
    setDirty(isPlaceholder);
    setEditing(true);
  };

  const handleSaveClick = async () => {
    if (saving || locked) return;
    if (!dirty && !isPlaceholder) return;
    setSaving(true);
    try {
      const payload: OperationalStandupCreate = {
        profile: row.profile.uid,
        org: row.org_uid,
        standup_date: e?.standup_date ?? "",
        breakthrough_type: breakthroughType,
        priorities,
        collaboration_need: collab,
        remarks,
      };
      await onSave(payload, e?.uid ?? null);
      setDirty(false);
      setJustSaved(true);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setBreakthroughType(e?.breakthrough_type ?? "");
    setPriorities(e?.priorities ?? "");
    setCollab(e?.collaboration_need ?? "");
    setRemarks(e?.remarks ?? "");
    setDirty(false);
    setEditing(false);
  };

  const cellS: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    verticalAlign: "top",
  };

  const readOnlyTextS: React.CSSProperties = {
    color: "#475569",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  const placeholderTextS: React.CSSProperties = {
    color: "#94a3b8",
  };

  const saveLabel = saving ? "Saving…" : justSaved ? "Saved ✓" : "Save";
  const saveBg = justSaved ? "#16a34a" : "#2563eb";

  // ── Type cell ────────────────────────────────────────────────────────────
  const renderTypeCell = () => {
    if (isPlaceholder && !editing) {
      return <span style={placeholderTextS}>—</span>;
    }
    if (!editing) {
      return (
        <span style={readOnlyTextS}>
          {breakthroughType || <span style={placeholderTextS}>—</span>}
        </span>
      );
    }
    return (
      <select
        value={breakthroughType}
        onChange={(ev) => {
          setBreakthroughType(ev.target.value as BreakthroughTypeValue);
          setDirty(true);
        }}
        style={{ width: "100%", fontSize: 12, padding: "4px" }}
      >
        <option value="">—</option>
        <option value="Breakdown">Breakdown</option>
        <option value="Breakthrough">Breakthrough</option>
      </select>
    );
  };

  const renderPrioritiesCell = () => {
    if (isPlaceholder && !editing) {
      return <span style={placeholderTextS}>Not submitted</span>;
    }
    if (!editing) {
      return (
        <div style={readOnlyTextS}>
          {priorities || <span style={placeholderTextS}>—</span>}
        </div>
      );
    }
    return (
      <textarea
        value={priorities}
        onChange={(ev) => {
          setPriorities(ev.target.value);
          setDirty(true);
        }}
        placeholder="Top priorities for the day…"
        style={{
          width: "100%",
          minHeight: 40,
          fontSize: 12,
          padding: 4,
          resize: "vertical",
        }}
      />
    );
  };

  const renderCollabCell = () => {
    if (isPlaceholder && !editing) {
      return <span style={placeholderTextS}>—</span>;
    }
    if (!editing) {
      return (
        <div style={readOnlyTextS}>
          {collab || <span style={placeholderTextS}>—</span>}
        </div>
      );
    }
    return (
      <input
        value={collab}
        onChange={(ev) => {
          setCollab(ev.target.value);
          setDirty(true);
        }}
        placeholder="Collaboration need…"
        style={{ width: "100%", fontSize: 12, padding: 4 }}
      />
    );
  };

  const renderRemarksCell = () => {
    if (isPlaceholder && !editing) {
      return <span style={placeholderTextS}>—</span>;
    }
    if (!editing) {
      return (
        <div style={readOnlyTextS}>
          {remarks || <span style={placeholderTextS}>—</span>}
        </div>
      );
    }
    return (
      <input
        value={remarks}
        onChange={(ev) => {
          setRemarks(ev.target.value);
          setDirty(true);
        }}
        placeholder="Remarks…"
        style={{ width: "100%", fontSize: 12, padding: 4 }}
      />
    );
  };

  const editButtonLabel = isPlaceholder ? "+ Add" : "Edit";

  return (
    <tr style={{ background: isPlaceholder ? "#f8fafc" : "#fff" }}>
      <td style={cellS}>{row.profile.full_name}</td>
      <td style={cellS}>{renderTypeCell()}</td>
      <td style={cellS}>{renderPrioritiesCell()}</td>
      <td style={cellS}>{renderCollabCell()}</td>
      <td style={cellS}>{renderRemarksCell()}</td>
      <td style={cellS}>
        {e?.status === "Approved" && e.approved_by_detail
          ? e.approved_by_detail.full_name
          : (e?.created_by_detail?.full_name ?? "—")}
      </td>
      <td style={cellS}>
        {e ? (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              background: e.status === "Approved" ? "#f0fdf4" : "#fef3c7",
              color: e.status === "Approved" ? "#16a34a" : "#d97706",
            }}
          >
            {e.status}
          </span>
        ) : (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={cellS}>
        <div
          style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}
        >
          {!editing && !locked && (
            <button
              onClick={startEdit}
              style={{
                padding: "3px 10px",
                background: "#fff",
                color: "#1e293b",
                border: "1px solid #cbd5e1",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {editButtonLabel}
            </button>
          )}
          {editing && (
            <button
              onClick={() => void handleSaveClick()}
              disabled={(!dirty && !isPlaceholder) || saving}
              style={{
                padding: "3px 10px",
                background: saveBg,
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor:
                  (!dirty && !isPlaceholder) || saving ? "default" : "pointer",
                fontSize: 11,
                fontWeight: 700,
                opacity: (!dirty && !isPlaceholder) || saving ? 0.5 : 1,
              }}
            >
              {saveLabel}
            </button>
          )}
          {editing && !saving && (
            <button
              onClick={handleCancel}
              style={{
                padding: "3px 10px",
                background: "#e2e8f0",
                color: "#1e293b",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Cancel
            </button>
          )}
          {!editing && justSaved && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                background: "#f0fdf4",
                color: "#16a34a",
              }}
            >
              Saved ✓
            </span>
          )}
          {!editing && e && e.status === "Pending" && row.can_approve && (
            <button
              onClick={() => void onApprove(e.uid)}
              style={{
                padding: "3px 10px",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Approve
            </button>
          )}
          {!editing && isAdmin && e !== null && e.reviewed_at === null && (
            <button
              onClick={() => void onReview(e.uid)}
              style={{
                padding: "3px 10px",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Review
            </button>
          )}
          {!editing && e !== null && e.reviewed_at !== null && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                background: "#ede9fe",
                color: "#7c3aed",
              }}
              title={e.reviewed_by_detail?.full_name ?? ""}
            >
              ✓ Reviewed
              {e.reviewed_by_detail?.full_name
                ? ` · ${e.reviewed_by_detail.full_name}`
                : ""}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
