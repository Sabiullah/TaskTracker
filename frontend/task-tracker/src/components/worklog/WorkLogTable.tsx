import { getDayName } from "@/utils/date";
import { getPr, PRIORITIES } from "@/utils/worklog";

const DURATION_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h <= 12; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${h}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();
const DURATION_LIST_ID = "wl-duration-options";

const HMM_RE = /^(\d{1,2}):([0-5]\d)$/;

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
        list={DURATION_LIST_ID}
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
  const cell: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    verticalAlign: "middle",
  };
  const inInput: React.CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #2563eb",
    borderRadius: 4,
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const filtered = logs as Array<Record<string, unknown>>;
  const rows = newRows as Array<Record<string, unknown>>;

  if (loading) {
    return (
      <p style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>
        Loading…
      </p>
    );
  }

  return (
    <>
      <datalist id={DURATION_LIST_ID}>
        {DURATION_OPTIONS.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
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
                <td style={cell}></td>
                <td style={cell}></td>
                <td style={cell}>
                  <span
                    style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}
                  >
                    NEW
                  </span>
                </td>
                <td style={{ ...cell, minWidth: 130 }}>
                  {isAdmin ? (
                    <select
                      value={(row.name as string) || ""}
                      onChange={(e) => onSetNew(idx, "name", e.target.value)}
                      style={{
                        ...inInput,
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
                <td style={{ ...cell, minWidth: 90 }}>
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
                        style={{ ...inInput, cursor: "pointer" }}
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
                <td style={cell}>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    {getDayName(row.date as string)}
                  </span>
                </td>
                <td style={{ ...cell, minWidth: 130 }}>
                  <input
                    type="date"
                    min={minBackdate}
                    value={row.date as string}
                    onChange={(e) => onSetNew(idx, "date", e.target.value)}
                    style={inInput}
                  />
                </td>
                <td style={{ ...cell, minWidth: 130 }}>
                  <select
                    value={row.client as string}
                    onChange={(e) => onSetNew(idx, "client", e.target.value)}
                    style={{
                      ...inInput,
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
                <td style={{ ...cell, minWidth: 260 }}>
                  <input
                    type="text"
                    value={row.task_description as string}
                    onChange={(e) =>
                      onSetNew(idx, "task_description", e.target.value)
                    }
                    placeholder="Task description…"
                    style={inInput}
                  />
                </td>
                <td style={{ ...cell, minWidth: 140 }}>
                  <DurationPicker
                    value={(row.hours_worked as string) || ""}
                    onChange={(v) => onSetNew(idx, "hours_worked", v)}
                  />
                </td>
                <td style={{ ...cell, minWidth: 130 }}>
                  <select
                    value={row.priority as string}
                    onChange={(e) => onSetNew(idx, "priority", e.target.value)}
                    style={{
                      ...inInput,
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
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
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
              const pr = getPr(row.priority as string);
              const ed = editRows[row.id as string] as
                | Record<string, unknown>
                | undefined;
              const isEditing = !!ed;
              const canEdit = isAdmin || row.name === myName;
              const isSel = selected.has(row.id as string);
              const isMoving = moving === row.id;
              return (
                <tr
                  key={row.id as string}
                  style={{
                    background: isSel
                      ? "#dbeafe"
                      : isEditing
                        ? "#fffbeb"
                        : pr.rowBg,
                    borderBottom: `1px solid ${isSel ? "#93c5fd" : pr.border}`,
                    transition: "background .15s",
                    opacity: isMoving ? 0.6 : 1,
                  }}
                >
                  {/* ↑ ↓ move buttons */}
                  <td
                    style={{
                      ...cell,
                      width: 56,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <button
                      onClick={() => onMoveRow(row.id as string, "up")}
                      disabled={i === 0 || !!isMoving}
                      title="Move up"
                      style={{
                        padding: "1px 6px",
                        marginRight: 2,
                        border: "1px solid #e2e8f0",
                        borderRadius: 4,
                        background: i === 0 ? "#f8fafc" : "#fff",
                        cursor: i === 0 ? "default" : "pointer",
                        fontSize: 13,
                        color: i === 0 ? "#cbd5e1" : "#475569",
                        fontWeight: 700,
                        lineHeight: 1.4,
                      }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => onMoveRow(row.id as string, "down")}
                      disabled={i === filtered.length - 1 || !!isMoving}
                      title="Move down"
                      style={{
                        padding: "1px 6px",
                        border: "1px solid #e2e8f0",
                        borderRadius: 4,
                        background:
                          i === filtered.length - 1 ? "#f8fafc" : "#fff",
                        cursor:
                          i === filtered.length - 1 ? "default" : "pointer",
                        fontSize: 13,
                        color:
                          i === filtered.length - 1 ? "#cbd5e1" : "#475569",
                        fontWeight: 700,
                        lineHeight: 1.4,
                      }}
                    >
                      ▼
                    </button>
                  </td>
                  <td style={{ ...cell, width: 36 }}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggleSelect(row.id as string)}
                      style={{ cursor: "pointer", width: 15, height: 15 }}
                    />
                  </td>
                  <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                    {i + 1}
                  </td>
                  <td style={{ ...cell, fontWeight: 600, minWidth: 130 }}>
                    {isEditing && isAdmin ? (
                      <select
                        value={(ed!.name as string) || ""}
                        onChange={(e) =>
                          onSetEdit(row.id as string, "name", e.target.value)
                        }
                        style={{ ...inInput, cursor: "pointer" }}
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
                  <td style={{ ...cell, minWidth: 80 }}>
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
                            onChange={(e) =>
                              onSetEdit(
                                row.id as string,
                                "organization",
                                e.target.value,
                              )
                            }
                            style={{ ...inInput, cursor: "pointer" }}
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
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>
                          —
                        </span>
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
                  <td style={{ ...cell, color: "#64748b" }}>
                    {isEditing
                      ? getDayName(ed!.date as string)
                      : (row.day as string)}
                  </td>

                  {/* Date */}
                  <td style={{ ...cell, minWidth: 130 }}>
                    {isEditing ? (
                      <input
                        type="date"
                        min={minBackdate}
                        value={ed!.date as string}
                        onChange={(e) =>
                          onSetEdit(row.id as string, "date", e.target.value)
                        }
                        style={inInput}
                      />
                    ) : (
                      <span style={{ color: "#475569" }}>
                        {row.date as string}
                      </span>
                    )}
                  </td>

                  {/* Client */}
                  <td style={{ ...cell, minWidth: 130 }}>
                    {isEditing ? (
                      <select
                        value={(ed!.client as string) || ""}
                        onChange={(e) =>
                          onSetEdit(row.id as string, "client", e.target.value)
                        }
                        style={{ ...inInput, cursor: "pointer" }}
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
                  <td style={{ ...cell, minWidth: 260 }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={(ed!.task_description as string) || ""}
                        onChange={(e) =>
                          onSetEdit(
                            row.id as string,
                            "task_description",
                            e.target.value,
                          )
                        }
                        style={inInput}
                      />
                    ) : (
                      (row.task_description as string)
                    )}
                  </td>

                  {/* Hours */}
                  <td style={{ ...cell, minWidth: 140 }}>
                    {isEditing ? (
                      <DurationPicker
                        value={(ed!.hours_worked as string) || ""}
                        onChange={(v) =>
                          onSetEdit(row.id as string, "hours_worked", v)
                        }
                      />
                    ) : (
                      <span style={{ fontWeight: 700 }}>
                        {(row.hours_worked as string) || "—"}
                      </span>
                    )}
                  </td>

                  {/* Priority */}
                  <td style={{ ...cell, minWidth: 130 }}>
                    {isEditing ? (
                      <select
                        value={(ed!.priority as string) || "Normal"}
                        onChange={(e) =>
                          onSetEdit(
                            row.id as string,
                            "priority",
                            e.target.value,
                          )
                        }
                        style={{
                          ...inInput,
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
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {canEdit &&
                      (isEditing ? (
                        <>
                          <button
                            onClick={() => onSaveEdit(row.id as string)}
                            disabled={saving[row.id as string]}
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
                            {saving[row.id as string] ? "…" : "✓ Save"}
                          </button>
                          <button
                            onClick={() => onCancelEdit(row.id as string)}
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
                            onClick={() => onDeleteRow(row.id as string)}
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
