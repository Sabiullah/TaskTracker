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

export default function SubtaskTable({
  subs,
  categories,
  members,
  mainTargetDate,
  viewerName,
  canManageAll,
  onChange,
}: Props) {
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
            <th>Owner *</th>
            <th>Target *</th>
            <th>Expected</th>
            <th>Completed</th>
            <th>Remarks</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {subs.map((s, i) => {
            const dateErr = violatesMain(s.targetDate);
            const expErr = violatesExpected(s);
            const editable = canEditRow(s);
            const lockTitle = editable
              ? undefined
              : `Allocated to ${s.responsible || "someone else"} — only they, a manager, or an admin can edit this row.`;
            return (
              <tr
                key={s.id ?? i}
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
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={s.description}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { description: e.target.value })}
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
                  <input
                    type="text"
                    value={s.remarks}
                    disabled={!editable}
                    onChange={(e) => updateAt(i, { remarks: e.target.value })}
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
