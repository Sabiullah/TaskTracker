import { useEffect, useState } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupRowProps {
  row: OperationalStandupRosterRow;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string) => Promise<void>;
}

export function DailyStandupRow({ row, onSave, onApprove }: DailyStandupRowProps) {
  const e = row.entry;
  const [breakthroughType, setBreakthroughType] = useState<BreakthroughTypeValue>(
    e?.breakthrough_type ?? "",
  );
  const [priorities, setPriorities] = useState(e?.priorities ?? "");
  const [collab, setCollab] = useState(e?.collaboration_need ?? "");
  const [remarks, setRemarks] = useState(e?.remarks ?? "");
  const [dirty, setDirty] = useState(false);

  // No prop→state sync effect on `e?.uid` change: parent re-keys the row by
  // entry uid (see DailyStandupDateSection), so when an entry materialises
  // (placeholder → DTO) the row remounts and useState initializers re-run.

  const isPlaceholder = e === null;
  const locked = !row.can_edit;

  // Debounced save: 600ms after the last change.
  useEffect(() => {
    if (!dirty || locked) return;
    const t = setTimeout(() => {
      const payload: OperationalStandupCreate = {
        profile: row.profile.uid,
        org: row.org_uid,
        standup_date: e?.standup_date ?? "",
        breakthrough_type: breakthroughType,
        priorities,
        collaboration_need: collab,
        remarks,
      };
      void onSave(payload, e?.uid ?? null);
      setDirty(false);
    }, 600);
    return () => clearTimeout(t);
  }, [dirty, breakthroughType, priorities, collab, remarks, locked, e, row, onSave]);

  const cellS: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    verticalAlign: "top",
  };

  return (
    <tr style={{ background: isPlaceholder ? "#f8fafc" : "#fff" }}>
      <td style={cellS}>{row.profile.full_name}</td>
      <td style={cellS}>
        {isPlaceholder ? (
          <span style={{ color: "#94a3b8" }}>—</span>
        ) : (
          <select
            disabled={locked}
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
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? (
          <span style={{ color: "#94a3b8" }}>Not submitted</span>
        ) : (
          <textarea
            disabled={locked}
            value={priorities}
            onChange={(ev) => {
              setPriorities(ev.target.value);
              setDirty(true);
            }}
            placeholder="Top priorities for the day…"
            style={{ width: "100%", minHeight: 40, fontSize: 12, padding: 4, resize: "vertical" }}
          />
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? "—" : (
          <input
            disabled={locked}
            value={collab}
            onChange={(ev) => { setCollab(ev.target.value); setDirty(true); }}
            placeholder="Collaboration need…"
            style={{ width: "100%", fontSize: 12, padding: 4 }}
          />
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? "—" : (
          <input
            disabled={locked}
            value={remarks}
            onChange={(ev) => { setRemarks(ev.target.value); setDirty(true); }}
            placeholder="Remarks…"
            style={{ width: "100%", fontSize: 12, padding: 4 }}
          />
        )}
      </td>
      <td style={cellS}>
        {e?.status === "Approved" && e.approved_by_detail
          ? e.approved_by_detail.full_name
          : e?.created_by_detail?.full_name ?? "—"}
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
        {e && e.status === "Pending" && row.can_approve && (
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
      </td>
    </tr>
  );
}
