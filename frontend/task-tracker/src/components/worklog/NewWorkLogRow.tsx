import { memo, useCallback, useState, type CSSProperties } from "react";
import { getDayName } from "@/utils/date";
import { getPr, PRIORITIES, BLANK_ROW } from "@/utils/worklog";
import type { WorkLog } from "@/types";
import type { OrgOption } from "@/components/worklog/WorkLogTable";

const HMM_RE = /^(\d{1,2}):([0-5]\d)$/;

const CELL_STYLE: CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  verticalAlign: "middle",
};
const IN_INPUT_STYLE: CSSProperties = {
  padding: "4px 6px",
  border: "1.5px solid #2563eb",
  borderRadius: 4,
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export interface NewRowDraft extends Omit<WorkLog, "id"> {
  _id: number;
}

interface ClientObject {
  name: string;
  orgs: string[];
}

export interface NewRowSlot {
  id: number;
  defaultName: string;
  defaultOrg: string;
}

interface NewWorkLogRowProps {
  slot: NewRowSlot;
  isAdmin: boolean;
  myName: string;
  memberNames: string[];
  orgs: readonly OrgOption[];
  selectedOrg: string;
  orgNameByUid: Record<string, string>;
  clientObjects: ClientObject[];
  availableClients: string[];
  minBackdate: string | undefined;
  isSaving: boolean;
  onSave: (id: number, draft: NewRowDraft) => void;
  onCancel: (id: number) => void;
}

/**
 * Self-contained "new row" with internal draft state. Typing into any field
 * only re-renders this component — parent WorkLogPage / WorkLogTable / sibling
 * rows are untouched. That's the difference between snappy typing and the
 * multi-second lag the user reported when draft state lived in WorkLogPage.
 */
function NewWorkLogRowImpl({
  slot,
  isAdmin,
  myName,
  memberNames,
  orgs,
  selectedOrg,
  orgNameByUid,
  clientObjects,
  availableClients,
  minBackdate,
  isSaving,
  onSave,
  onCancel,
}: NewWorkLogRowProps) {
  const [draft, setDraft] = useState<NewRowDraft>(() => ({
    ...(BLANK_ROW as unknown as NewRowDraft),
    _id: slot.id,
    name: slot.defaultName,
    organization: slot.defaultOrg,
  }));

  const setField = useCallback(
    (k: keyof NewRowDraft, v: unknown) =>
      setDraft((d) => ({ ...d, [k]: v }) as NewRowDraft),
    [],
  );

  const hoursInvalid = !!draft.hours_worked && !HMM_RE.test(draft.hours_worked);
  const pr = getPr(draft.priority);

  return (
    <tr
      style={{
        background: "#eff6ff",
        borderBottom: "2px solid #2563eb",
      }}
    >
      <td style={CELL_STYLE}></td>
      <td style={CELL_STYLE}></td>
      <td style={CELL_STYLE}>
        <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}>
          NEW
        </span>
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        {isAdmin ? (
          <select
            value={draft.name}
            onChange={(e) => setField("name", e.target.value)}
            style={{
              ...IN_INPUT_STYLE,
              cursor: "pointer",
              borderColor: draft.name ? "#2563eb" : "#dc2626",
            }}
          >
            <option value="">— Name * —</option>
            {memberNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontWeight: 600, color: "#2563eb" }}>{myName}</span>
        )}
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 90 }}>
        {orgs.length > 0 ? (
          selectedOrg ? (
            <span
              style={{
                background: "#eff6ff",
                color: "#2563eb",
                padding: "2px 7px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                border: "1px solid #bfdbfe",
              }}
            >
              {orgNameByUid[selectedOrg] ?? selectedOrg}
            </span>
          ) : (
            <select
              value={draft.organization}
              onChange={(e) => setField("organization", e.target.value)}
              style={{ ...IN_INPUT_STYLE, cursor: "pointer" }}
            >
              <option value="">— Org —</option>
              {orgs.map((o) => (
                <option key={o.uid} value={o.uid}>
                  {o.name}
                </option>
              ))}
            </select>
          )
        ) : (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={CELL_STYLE}>
        <span style={{ color: "#64748b", fontSize: 12 }}>
          {getDayName(draft.date)}
        </span>
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        <input
          type="date"
          min={minBackdate}
          value={draft.date}
          onChange={(e) => setField("date", e.target.value)}
          style={IN_INPUT_STYLE}
        />
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        <select
          value={draft.client}
          onChange={(e) => setField("client", e.target.value)}
          style={{
            ...IN_INPUT_STYLE,
            cursor: "pointer",
            borderColor: draft.client ? "#2563eb" : "#dc2626",
          }}
        >
          <option value="">— Client * —</option>
          {(draft.organization
            ? clientObjects
                .filter((c) => c.orgs.includes(draft.organization))
                .map((c) => c.name)
            : availableClients
          ).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {!draft.client && (
          <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>
            Required
          </div>
        )}
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 260 }}>
        <input
          type="text"
          value={draft.task_description}
          onChange={(e) => setField("task_description", e.target.value)}
          placeholder="Task description…"
          style={IN_INPUT_STYLE}
        />
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 140 }}>
        <input
          type="text"
          value={draft.hours_worked}
          onChange={(e) => setField("hours_worked", e.target.value)}
          placeholder="H:MM"
          maxLength={6}
          inputMode="numeric"
          style={{
            padding: "4px 6px",
            border: `1.5px solid ${hoursInvalid ? "#dc2626" : "#2563eb"}`,
            borderRadius: 4,
            fontSize: 12,
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
        {hoursInvalid && (
          <div style={{ fontSize: 10, color: "#dc2626" }}>Use H:MM</div>
        )}
      </td>
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        <select
          value={draft.priority}
          onChange={(e) => setField("priority", e.target.value)}
          style={{
            ...IN_INPUT_STYLE,
            cursor: "pointer",
            background: pr.badgeBg,
            color: pr.badge,
            fontWeight: 700,
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
        <button
          onClick={() => onSave(slot.id, draft)}
          disabled={isSaving}
          style={{
            padding: "3px 10px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 12,
            marginRight: 4,
          }}
        >
          {isSaving ? "…" : "✓ Save"}
        </button>
        <button
          onClick={() => onCancel(slot.id)}
          style={{
            padding: "3px 8px",
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

export default memo(NewWorkLogRowImpl);
