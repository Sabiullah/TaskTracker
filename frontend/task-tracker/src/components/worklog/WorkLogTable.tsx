import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { getDayName } from "@/utils/date";
import { getPr, PRIORITIES } from "@/utils/worklog";

const HMM_RE = /^(\d{1,2}):([0-5]\d)$/;

// Hoisted so the per-row React.memo isn't broken by fresh object identities
// every render. With 1300+ rows, an inline style object was enough to force
// every row to re-render on every keystroke.
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

function DurationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const invalid = !!value && !HMM_RE.test(value);
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="H:MM"
        maxLength={6}
        inputMode="numeric"
        style={{
          padding: "4px 6px",
          border: `1.5px solid ${invalid ? "#dc2626" : "#2563eb"}`,
          borderRadius: 4,
          fontSize: 12,
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "inherit",
        }}
      />
      {invalid && (
        <div style={{ fontSize: 10, color: "#dc2626" }}>Use H:MM</div>
      )}
    </>
  );
}

interface ClientObject {
  name: string;
  /** Org UIDs the client belongs to. Used to filter the client dropdown
   *  when an org is selected — both sides are uid strings. */
  orgs: string[];
}

/** Minimal org option for the table dropdown. ``uid`` is the value
 *  persisted on the row; ``name`` is the human label. */
export interface OrgOption {
  readonly uid: string;
  readonly name: string;
}

export interface WorkLogTableProps {
  logs: unknown[]; // TODO: type as WorkLog[]
  newRows: unknown[]; // TODO: type as NewRow[]
  editRows: Record<string, unknown>; // TODO: type as Record<string, WorkLog>
  saving: Record<string, boolean>;
  moving: string | null;
  selected: Set<string>;
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
  memberNames: string[];
  /** Orgs the user can pick from — value is uid, label is name. */
  orgs: readonly OrgOption[];
  /** Currently selected org's uid (empty = "All Orgs"). */
  selectedOrg: string;
  /** uid → name resolver so the cell displays the friendly name even when
   *  the row's ``organization`` field is a uid. */
  orgNameByUid: Record<string, string>;
  clientObjects: ClientObject[];
  availableClients: string[];
  minBackdate: string | undefined;
  getDayName: (ds: string | null | undefined) => string;
  getPr: (v: string) => {
    value: string;
    label: string;
    rowBg: string;
    border: string;
    badge: string;
    badgeBg: string;
  };
  PRIORITIES: {
    value: string;
    label: string;
    rowBg: string;
    border: string;
    badge: string;
    badgeBg: string;
  }[];
  onStartEdit: (row: unknown) => void;
  onCancelEdit: (id: string) => void;
  onSetEdit: (id: string, k: string, v: unknown) => void;
  onSaveEdit: (id: string) => void;
  onDeleteRow: (id: string) => void;
  onMoveRow: (id: string, direction: "up" | "down") => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  isAllSelected: boolean;
  onSetNew: (idx: number, k: string, v: unknown) => void;
  onCancelNew: (idx: number) => void;
  onSaveNew: (idx: number) => void;
  sortBy: string;
  sortDir: string;
  onSort: (key: string) => void;
  loading: boolean;
}

// ── WorkLogRow ─────────────────────────────────────────────────────────────
// Each existing row is its own memoized component so that typing in one row
// (or selecting / starting an edit on one row) re-renders only that row
// instead of all ~1300+ rows in the table. Without this, every keystroke
// forced React to re-reconcile the entire table, which is the cause of the
// visible typing lag.
interface WorkLogRowProps {
  row: Record<string, unknown>;
  i: number;
  isFirst: boolean;
  isLast: boolean;
  editRow: Record<string, unknown> | undefined;
  isSelected: boolean;
  isMoving: boolean;
  isSaving: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  memberNames: string[];
  orgs: readonly OrgOption[];
  selectedOrg: string;
  orgNameByUid: Record<string, string>;
  clientObjects: ClientObject[];
  availableClients: string[];
  minBackdate: string | undefined;
  onStartEdit: (row: unknown) => void;
  onCancelEdit: (id: string) => void;
  onSetEdit: (id: string, k: string, v: unknown) => void;
  onSaveEdit: (id: string) => void;
  onDeleteRow: (id: string) => void;
  onMoveRow: (id: string, direction: "up" | "down") => void;
  onToggleSelect: (id: string) => void;
}

const WorkLogRow = memo(function WorkLogRow({
  row,
  i,
  isFirst,
  isLast,
  editRow,
  isSelected,
  isMoving,
  isSaving,
  canEdit,
  isAdmin,
  memberNames,
  orgs,
  selectedOrg,
  orgNameByUid,
  clientObjects,
  availableClients,
  minBackdate,
  onStartEdit,
  onCancelEdit,
  onSetEdit,
  onSaveEdit,
  onDeleteRow,
  onMoveRow,
  onToggleSelect,
}: WorkLogRowProps) {
  const pr = getPr(row.priority as string);
  const ed = editRow;
  const isEditing = !!ed;
  const id = row.id as string;
  return (
    <tr
      style={{
        background: isSelected
          ? "#dbeafe"
          : isEditing
            ? "#fffbeb"
            : pr.rowBg,
        borderBottom: `1px solid ${isSelected ? "#93c5fd" : pr.border}`,
        transition: "background .15s",
        opacity: isMoving ? 0.6 : 1,
      }}
    >
      {/* ↑ ↓ move buttons */}
      <td
        style={{
          ...CELL_STYLE,
          width: 56,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        <button
          onClick={() => onMoveRow(id, "up")}
          disabled={isFirst || isMoving}
          title="Move up"
          style={{
            padding: "1px 6px",
            marginRight: 2,
            border: "1px solid #e2e8f0",
            borderRadius: 4,
            background: isFirst ? "#f8fafc" : "#fff",
            cursor: isFirst ? "default" : "pointer",
            fontSize: 13,
            color: isFirst ? "#cbd5e1" : "#475569",
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          ▲
        </button>
        <button
          onClick={() => onMoveRow(id, "down")}
          disabled={isLast || isMoving}
          title="Move down"
          style={{
            padding: "1px 6px",
            border: "1px solid #e2e8f0",
            borderRadius: 4,
            background: isLast ? "#f8fafc" : "#fff",
            cursor: isLast ? "default" : "pointer",
            fontSize: 13,
            color: isLast ? "#cbd5e1" : "#475569",
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          ▼
        </button>
      </td>
      <td style={{ ...CELL_STYLE, width: 36 }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(id)}
          style={{ cursor: "pointer", width: 15, height: 15 }}
        />
      </td>
      <td style={{ ...CELL_STYLE, color: "#94a3b8", fontSize: 12 }}>{i + 1}</td>
      <td style={{ ...CELL_STYLE, fontWeight: 600, minWidth: 130 }}>
        {isEditing && isAdmin ? (
          <select
            value={(ed!.name as string) || ""}
            onChange={(e) => onSetEdit(id, "name", e.target.value)}
            style={{ ...IN_INPUT_STYLE, cursor: "pointer" }}
          >
            <option value="">— Name —</option>
            {memberNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          (row.name as string)
        )}
      </td>
      {/* Org cell */}
      <td style={{ ...CELL_STYLE, minWidth: 80 }}>
        {isEditing ? (
          orgs.length > 0 ? (
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
                value={(ed!.organization as string) || ""}
                onChange={(e) => onSetEdit(id, "organization", e.target.value)}
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
          )
        ) : row.organization ? (
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
            {orgNameByUid[row.organization as string] ??
              (row.organization as string)}
          </span>
        ) : (
          <span style={{ color: "#94a3b8" }}>—</span>
        )}
      </td>
      <td style={{ ...CELL_STYLE, color: "#64748b" }}>
        {isEditing
          ? getDayName(ed!.date as string)
          : (row.day as string)}
      </td>

      {/* Date */}
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        {isEditing ? (
          <input
            type="date"
            min={minBackdate}
            value={ed!.date as string}
            onChange={(e) => onSetEdit(id, "date", e.target.value)}
            style={IN_INPUT_STYLE}
          />
        ) : (
          <span style={{ color: "#475569" }}>{row.date as string}</span>
        )}
      </td>

      {/* Client */}
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        {isEditing ? (
          <select
            value={(ed!.client as string) || ""}
            onChange={(e) => onSetEdit(id, "client", e.target.value)}
            style={{ ...IN_INPUT_STYLE, cursor: "pointer" }}
          >
            <option value="">— Client —</option>
            {(ed!.organization
              ? clientObjects
                  .filter((c) =>
                    c.orgs.includes(ed!.organization as string),
                  )
                  .map((c) => c.name)
              : availableClients
            ).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : row.client ? (
          <span
            style={{
              background: "#eff6ff",
              color: "#2563eb",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {row.client as string}
          </span>
        ) : (
          <span style={{ color: "#94a3b8" }}>—</span>
        )}
      </td>

      {/* Task */}
      <td style={{ ...CELL_STYLE, minWidth: 260 }}>
        {isEditing ? (
          <input
            type="text"
            value={(ed!.task_description as string) || ""}
            onChange={(e) => onSetEdit(id, "task_description", e.target.value)}
            style={IN_INPUT_STYLE}
          />
        ) : (
          (row.task_description as string)
        )}
      </td>

      {/* Hours */}
      <td style={{ ...CELL_STYLE, minWidth: 140 }}>
        {isEditing ? (
          <DurationPicker
            value={(ed!.hours_worked as string) || ""}
            onChange={(v) => onSetEdit(id, "hours_worked", v)}
          />
        ) : (
          <span style={{ fontWeight: 700 }}>
            {(row.hours_worked as string) || "—"}
          </span>
        )}
      </td>

      {/* Priority */}
      <td style={{ ...CELL_STYLE, minWidth: 130 }}>
        {isEditing ? (
          <select
            value={(ed!.priority as string) || "Normal"}
            onChange={(e) => onSetEdit(id, "priority", e.target.value)}
            style={{
              ...IN_INPUT_STYLE,
              cursor: "pointer",
              background: getPr(ed!.priority as string).badgeBg,
              color: getPr(ed!.priority as string).badge,
              fontWeight: 700,
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            style={{
              background: pr.badgeBg,
              color: pr.badge,
              padding: "2px 9px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              border: `1px solid ${pr.border}`,
            }}
          >
            {row.priority as string}
          </span>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
        {canEdit &&
          (isEditing ? (
            <>
              <button
                onClick={() => onSaveEdit(id)}
                disabled={isSaving}
                style={{
                  padding: "3px 10px",
                  background: "#16a34a",
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
                onClick={() => onCancelEdit(id)}
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
            </>
          ) : (
            <>
              <button
                onClick={() => onStartEdit(row)}
                style={{
                  padding: "3px 10px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  marginRight: 4,
                }}
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => onDeleteRow(id)}
                style={{
                  padding: "3px 8px",
                  border: "1px solid #fecaca",
                  background: "#fff1f2",
                  color: "#dc2626",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                🗑
              </button>
            </>
          ))}
      </td>
    </tr>
  );
});

export default function WorkLogTable({
  logs,
  newRows,
  editRows,
  saving,
  moving,
  selected,
  isAdmin,
  myName,
  memberNames,
  orgs,
  selectedOrg,
  orgNameByUid,
  clientObjects,
  availableClients,
  minBackdate,
  onStartEdit,
  onCancelEdit,
  onSetEdit,
  onSaveEdit,
  onDeleteRow,
  onMoveRow,
  onToggleSelect,
  onToggleSelectAll,
  isAllSelected,
  onSetNew,
  onCancelNew,
  onSaveNew,
  sortBy,
  sortDir,
  onSort,
  loading,
}: WorkLogTableProps) {
  const filtered = logs as Array<Record<string, unknown>>;
  const rows = newRows as Array<Record<string, unknown>>;

  // Stable handler references so per-keystroke parent re-renders don't pass
  // fresh function identities into ``WorkLogRow``. The ref always holds the
  // latest closures; the wrappers below are created once. Without this the
  // ``React.memo`` on ``WorkLogRow`` would never skip — handler identity
  // would change every render even when nothing about that row changed.
  const handlersRef = useRef({
    onStartEdit,
    onCancelEdit,
    onSetEdit,
    onSaveEdit,
    onDeleteRow,
    onMoveRow,
    onToggleSelect,
  });
  // ``useLayoutEffect`` (not ``useEffect``) so the ref is refreshed
  // synchronously before the next paint — user-interaction handlers always
  // call the latest closures. Updating during render trips the
  // ``react-hooks/refs`` rule.
  useLayoutEffect(() => {
    handlersRef.current = {
      onStartEdit,
      onCancelEdit,
      onSetEdit,
      onSaveEdit,
      onDeleteRow,
      onMoveRow,
      onToggleSelect,
    };
  });
  const stableHandlers = useMemo(
    () => ({
      onStartEdit: (row: unknown) => handlersRef.current.onStartEdit(row),
      onCancelEdit: (id: string) => handlersRef.current.onCancelEdit(id),
      onSetEdit: (id: string, k: string, v: unknown) =>
        handlersRef.current.onSetEdit(id, k, v),
      onSaveEdit: (id: string) => handlersRef.current.onSaveEdit(id),
      onDeleteRow: (id: string) => handlersRef.current.onDeleteRow(id),
      onMoveRow: (id: string, direction: "up" | "down") =>
        handlersRef.current.onMoveRow(id, direction),
      onToggleSelect: (id: string) => handlersRef.current.onToggleSelect(id),
    }),
    [],
  );

  if (loading) {
    return (
      <p style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>
        Loading…
      </p>
    );
  }

  const lastIdx = filtered.length - 1;

  return (
    <>
      <div
        className="sticky-table-wrap"
        style={{ borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th
                style={{
                  padding: "9px 8px",
                  borderBottom: "2px solid #e2e8f0",
                  width: 56,
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                ORDER
              </th>
              <th
                style={{
                  padding: "9px 10px",
                  borderBottom: "2px solid #e2e8f0",
                  width: 36,
                }}
              >
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onToggleSelectAll}
                  title="Select all visible rows"
                  style={{ cursor: "pointer", width: 15, height: 15 }}
                />
              </th>
              {[
                { label: "#", key: null },
                { label: "Name", key: "name" },
                { label: "Org *", key: null },
                { label: "Day", key: null },
                { label: "Date", key: "date" },
                { label: "Client", key: "client" },
                { label: "Task Description", key: null },
                { label: "Hours", key: null },
                { label: "Priority", key: "priority" },
                { label: "Actions", key: null },
              ].map(({ label, key }) => {
                const active = sortBy === key;
                const arrow = active
                  ? sortDir === "asc"
                    ? " ▲"
                    : " ▼"
                  : key
                    ? " ⇅"
                    : "";
                return (
                  <th
                    key={label}
                    onClick={() => {
                      if (key) onSort(key);
                    }}
                    style={{
                      padding: "9px 10px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: active ? "#2563eb" : "#475569",
                      fontSize: 12,
                      borderBottom: "2px solid #e2e8f0",
                      whiteSpace: "nowrap",
                      cursor: key ? "pointer" : "default",
                      userSelect: "none",
                    }}
                  >
                    {label}
                    <span style={{ fontSize: 10, opacity: active ? 1 : 0.35 }}>
                      {arrow}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* New unsaved rows at top */}
            {rows.map((row, idx) => (
              <tr
                key={row._id as string}
                style={{
                  background: "#eff6ff",
                  borderBottom: "2px solid #2563eb",
                }}
              >
                <td style={CELL_STYLE}></td>
                <td style={CELL_STYLE}></td>
                <td style={CELL_STYLE}>
                  <span
                    style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}
                  >
                    NEW
                  </span>
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 130 }}>
                  {isAdmin ? (
                    <select
                      value={(row.name as string) || ""}
                      onChange={(e) => onSetNew(idx, "name", e.target.value)}
                      style={{
                        ...IN_INPUT_STYLE,
                        cursor: "pointer",
                        borderColor: row.name ? "#2563eb" : "#dc2626",
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
                    <span style={{ fontWeight: 600, color: "#2563eb" }}>
                      {myName}
                    </span>
                  )}
                </td>
                {/* Org cell for new row */}
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
                        value={(row.organization as string) || ""}
                        onChange={(e) =>
                          onSetNew(idx, "organization", e.target.value)
                        }
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
                    {getDayName(row.date as string)}
                  </span>
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 130 }}>
                  <input
                    type="date"
                    min={minBackdate}
                    value={row.date as string}
                    onChange={(e) => onSetNew(idx, "date", e.target.value)}
                    style={IN_INPUT_STYLE}
                  />
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 130 }}>
                  <select
                    value={row.client as string}
                    onChange={(e) => onSetNew(idx, "client", e.target.value)}
                    style={{
                      ...IN_INPUT_STYLE,
                      cursor: "pointer",
                      borderColor: row.client ? "#2563eb" : "#dc2626",
                    }}
                  >
                    <option value="">— Client * —</option>
                    {(row.organization
                      ? clientObjects
                          .filter((c) =>
                            c.orgs.includes(row.organization as string),
                          )
                          .map((c) => c.name)
                      : availableClients
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {!row.client && (
                    <div
                      style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}
                    >
                      Required
                    </div>
                  )}
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 260 }}>
                  <input
                    type="text"
                    value={row.task_description as string}
                    onChange={(e) =>
                      onSetNew(idx, "task_description", e.target.value)
                    }
                    placeholder="Task description…"
                    style={IN_INPUT_STYLE}
                  />
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 140 }}>
                  <DurationPicker
                    value={(row.hours_worked as string) || ""}
                    onChange={(v) => onSetNew(idx, "hours_worked", v)}
                  />
                </td>
                <td style={{ ...CELL_STYLE, minWidth: 130 }}>
                  <select
                    value={row.priority as string}
                    onChange={(e) => onSetNew(idx, "priority", e.target.value)}
                    style={{
                      ...IN_INPUT_STYLE,
                      cursor: "pointer",
                      background: getPr(row.priority as string).badgeBg,
                      color: getPr(row.priority as string).badge,
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
                    onClick={() => onSaveNew(idx)}
                    disabled={saving["new" + idx]}
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
                    {saving["new" + idx] ? "…" : "✓ Save"}
                  </button>
                  <button
                    onClick={() => onCancelNew(idx)}
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
            ))}

            {/* Existing rows */}
            {filtered.length === 0 && rows.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  style={{
                    padding: "30px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  No entries. Click + Add Row to start.
                </td>
              </tr>
            )}
            {filtered.map((row, i) => {
              const id = row.id as string;
              return (
                <WorkLogRow
                  key={id}
                  row={row}
                  i={i}
                  isFirst={i === 0}
                  isLast={i === lastIdx}
                  editRow={editRows[id] as Record<string, unknown> | undefined}
                  isSelected={selected.has(id)}
                  isMoving={moving === id}
                  isSaving={!!saving[id]}
                  canEdit={isAdmin || row.name === myName}
                  isAdmin={isAdmin}
                  memberNames={memberNames}
                  orgs={orgs}
                  selectedOrg={selectedOrg}
                  orgNameByUid={orgNameByUid}
                  clientObjects={clientObjects}
                  availableClients={availableClients}
                  minBackdate={minBackdate}
                  onStartEdit={stableHandlers.onStartEdit}
                  onCancelEdit={stableHandlers.onCancelEdit}
                  onSetEdit={stableHandlers.onSetEdit}
                  onSaveEdit={stableHandlers.onSaveEdit}
                  onDeleteRow={stableHandlers.onDeleteRow}
                  onMoveRow={stableHandlers.onMoveRow}
                  onToggleSelect={stableHandlers.onToggleSelect}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Import template note */}
      <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
        📌 Import CSV columns:{" "}
        <code>Name, Day, Date, Client, Task, Hours (H:MM), Priority</code>
      </div>
    </>
  );
}
