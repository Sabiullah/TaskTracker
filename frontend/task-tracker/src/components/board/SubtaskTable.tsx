import { useMemo, useState } from "react";
import type { SubtaskItem } from "@/types";

interface Props {
  subs: readonly SubtaskItem[];
  categories: readonly string[];
  members: readonly string[];
  /** ISO date string (YYYY-MM-DD) or empty. Caps each sub's target. */
  mainTargetDate: string;
  /** Display name of the current viewer — used to decide which sub rows
   *  the viewer is allowed to edit (employee mode). */
  viewerName: string;
  /** True when the viewer is admin or manager in the goal's org. They may
   *  edit every row regardless of who it's allocated to. */
  canManageAll: boolean;
  onChange: (next: SubtaskItem[]) => void;
}

const EMPTY_SUB: SubtaskItem = {
  id: null,
  description: "",
  category: "",
  responsible: "",
  targetDate: "",
  expectedDate: "",
  completedDate: "",
  remarks: "",
};

type SortKey = "none" | "target" | "owner";
type SortDir = "asc" | "desc";

export default function SubtaskTable({
  subs,
  categories,
  members,
  mainTargetDate,
  viewerName,
  canManageAll,
  onChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const updateAt = (idx: number, patch: Partial<SubtaskItem>) => {
    onChange(subs.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeAt = (idx: number) => {
    const row = subs[idx];
    if (row.id && !window.confirm("Remove this saved sub-task? It will be deleted on save.")) return;
    onChange(subs.filter((_, i) => i !== idx));
  };
  const addRow = () =>
    onChange([
      ...subs,
      // Pre-fill new rows for an employee with their own name so the
      // backend's "employees can only create rows for themselves" rule is
      // satisfied without making the user re-pick themselves every time.
      { ...EMPTY_SUB, responsible: canManageAll ? "" : viewerName },
    ]);

  const violatesMain = (d: string) =>
    !!d && !!mainTargetDate && d > mainTargetDate;
  const violatesExpected = (s: SubtaskItem) =>
    !!s.targetDate && !!s.expectedDate && s.expectedDate < s.targetDate;

  // Whether the current viewer may edit a given row.
  const canEditRow = (s: SubtaskItem) =>
    canManageAll || !s.responsible || s.responsible === viewerName;

  const onHeaderSort = (key: Exclude<SortKey, "none">) => {
    if (sortKey === key) {
      // Same column clicked again — flip direction, or clear sort if
      // we're already on desc (toggle through asc → desc → none).
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey("none");
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Render order as original-index array so per-row callbacks (updateAt /
  // removeAt) keep using the underlying position in `subs`. Sorting is a
  // pure view concern; the saved order in props stays untouched.
  const displayOrder = useMemo(() => {
    const indices = subs.map((_, i) => i);
    if (sortKey === "none") return indices;
    const dir = sortDir === "asc" ? 1 : -1;
    indices.sort((a, b) => {
      const ra = subs[a];
      const rb = subs[b];
      // Empty values always sort to the bottom regardless of direction so
      // unfilled new rows don't leap to the top of the list.
      const va = sortKey === "target" ? ra.targetDate : ra.responsible;
      const vb = sortKey === "target" ? rb.targetDate : rb.responsible;
      const aEmpty = !va;
      const bEmpty = !vb;
      if (aEmpty && bEmpty) return a - b;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const cmp =
        sortKey === "target" ? va.localeCompare(vb) : va.localeCompare(vb, undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp * dir;
      return a - b;
    });
    return indices;
  }, [subs, sortKey, sortDir]);

  const sortArrow = (key: Exclude<SortKey, "none">) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const sortableThStyle = (key: Exclude<SortKey, "none">): React.CSSProperties => ({
    cursor: "pointer",
    userSelect: "none",
    background: sortKey === key ? "#eff6ff" : undefined,
    color: sortKey === key ? "#2563eb" : undefined,
  });

  return (
    <div className="subtask-section">
      <div className="subtask-head">
        <strong>SUBTASKS ({subs.length})</strong>
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          + Add subtask
        </button>
      </div>
      <table className="subtask-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Description *</th>
            <th
              onClick={() => onHeaderSort("owner")}
              title="Sort by Owner"
              style={sortableThStyle("owner")}
            >
              Owner *{sortArrow("owner")}
            </th>
            <th
              onClick={() => onHeaderSort("target")}
              title="Sort by Target date"
              style={sortableThStyle("target")}
            >
              Target *{sortArrow("target")}
            </th>
            <th>Expected</th>
            <th>Completed</th>
            <th>Remarks</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {displayOrder.map((i) => {
            const s = subs[i];
            const dateErr = violatesMain(s.targetDate);
            const expErr = violatesExpected(s);
            const editable = canEditRow(s);
            const lockTitle = editable
              ? undefined
              : `Allocated to ${s.responsible || "someone else"} — only they, a manager, or an admin can edit this row.`;
            return (
              <tr
                key={s.id ?? `idx-${i}`}
                data-sub-uid={s.id ?? undefined}
                className={editable ? undefined : "sub-locked"}
                title={lockTitle}
              >
                <td>
                  <select
                    value={s.category}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { category: e.target.value })}
                  >
                    <option value="">—</option>
                    {/* Always include the row's current value as an option
                     *  even when it isn't in the filtered list (e.g. main
                     *  category was changed and the old sub-category isn't
                     *  a child of the new main). Prevents the dropdown
                     *  from silently dropping the saved label. */}
                    {(s.category && !categories.includes(s.category)
                      ? [s.category, ...categories]
                      : categories
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <textarea
                    className="subtask-textarea"
                    rows={1}
                    value={s.description}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { description: e.target.value })}
                    onInput={(e) => {
                      const ta = e.currentTarget;
                      ta.style.height = "auto";
                      ta.style.height = ta.scrollHeight + "px";
                    }}
                    ref={(el) => {
                      if (el) {
                        el.style.height = "auto";
                        el.style.height = el.scrollHeight + "px";
                      }
                    }}
                  />
                </td>
                <td>
                  <select
                    value={s.responsible}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { responsible: e.target.value })}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="date"
                    value={s.targetDate}
                    max={mainTargetDate || undefined}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { targetDate: e.target.value })}
                    className={dateErr ? "subtask-date-err" : undefined}
                  />
                  {dateErr && (
                    <div className="subtask-err">
                      Sub-task target date cannot be after the main goal&apos;s target date ({mainTargetDate}).
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    value={s.expectedDate}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { expectedDate: e.target.value })}
                    className={expErr ? "subtask-date-err" : undefined}
                  />
                  {expErr && (
                    <div className="subtask-err">
                      Expected cannot be before target.
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    value={s.completedDate}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { completedDate: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className="subtask-textarea"
                    rows={1}
                    value={s.remarks}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { remarks: e.target.value })}
                    onInput={(e) => {
                      const ta = e.currentTarget;
                      ta.style.height = "auto";
                      ta.style.height = ta.scrollHeight + "px";
                    }}
                    ref={(el) => {
                      if (el) {
                        el.style.height = "auto";
                        el.style.height = el.scrollHeight + "px";
                      }
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => removeAt(i)}
                    disabled={!editable}
                    aria-label="Remove"
                  >
                    &#x2715;
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
