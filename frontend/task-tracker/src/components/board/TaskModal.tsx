import { useState, useEffect, useMemo, useRef } from "react";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import { useAuth } from "@/hooks/useAuth";
import MainGoalFields from "./MainGoalFields";
import SubtaskTable from "./SubtaskTable";
import { hasSubErrors } from "./subtaskHelpers";
import {
  generateOccurrences,
  thisMonthString,
  monthsBetween,
  addMonthsToYearMonth,
} from "./recurrence";
import type { OrgOption } from "./TaskFormFields";
import type { Task, SubtaskItem } from "@/types";
import type { MasterRecurrence } from "@/types/api";

/** One sub-category template, denormalised from the cat masters list so
 *  the occurrence engine has everything it needs in one place. */
interface SubTemplate {
  name: string;
  recurrence: MasterRecurrence;
  targetDay: number | null;
}

/** "2026-05-15" → "May 2026". Used to suffix per-occurrence subtask
 *  descriptions so the user can distinguish 12 monthly rows at a glance.
 *  The locale is fixed to ``en-US`` so the format stays predictable for
 *  on-screen + DB consumers; date inputs themselves remain ISO. */
function monthLabel(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(d);
}

export interface TaskModalProps {
  task?: Partial<Task> | null;
  /** When opening from a sub-row, which sub uid to scroll to. */
  focusSubId?: string | null;
  /** Existing subs of the goal being edited (already loaded by caller). */
  initialSubs?: readonly SubtaskItem[];
  defaultStatus?: string;
  onSave: (
    main: Partial<Task> & { id?: string },
    subs: SubtaskItem[],
  ) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

const EMPTY = {
  client: "", category: "", description: "", status: "Pending",
  targetDate: "", expectedDate: "", completedDate: "",
  responsible: "", reportingManager: "", remarks: "", recurrence: "Onetime", organization: "",
};

export default function TaskModal({
  task,
  focusSubId = null,
  initialSubs = [],
  defaultStatus,
  onSave,
  onClose,
  onDelete,
}: TaskModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [subs, setSubs] = useState<SubtaskItem[]>([]);
  // Engagement window for the occurrence engine. ``startMonth`` is
  // ``YYYY-MM`` (matches ``<input type="month">``); ``engagementMonths``
  // is the number of months over which sub-templates materialise their
  // occurrences (e.g. 12 monthly + 4 quarterly + 1 yearly for a one-year
  // engagement starting in May 2026).
  const [startMonth, setStartMonth] = useState<string>(thisMonthString());
  const [engagementMonths, setEngagementMonths] = useState<number>(12);
  // The month being viewed in the subtask grid. Defaults to today's calendar
  // month. Past months render read-only.
  const [viewMonth, setViewMonth] = useState<string>(thisMonthString());

  const { orgs: myOrgs, profile, isAdminIn, isManagerIn } = useAuth();
  const orgs = useMemo<OrgOption[]>(
    () => myOrgs.map((o) => ({ uid: o.uid, name: o.name })),
    [myOrgs],
  );
  const viewerName = profile?.full_name ?? "";

  const { clients: clientMasters, cats: catMasters } = useMasters();
  const { profiles } = useProfiles();
  const clientObjects = useMemo(
    () =>
      clientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientMasters],
  );
  // Categories with a parent are sub-categories — they only show up in
  // the per-subtask dropdown, never in the goal-level "main category"
  // picker. Sub-categories are also used to auto-populate the subtask
  // grid when a user picks a main category.
  const mainCategories = useMemo(
    () =>
      [
        ...new Set(catMasters.filter((c) => !c.parent).map((c) => c.name)),
      ].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
  const allCategories = useMemo(
    () => [...new Set(catMasters.map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
  // Map main-category name → ordered list of child sub-category
  // templates (name + recurrence + target_day). Cats are looked up by
  // id (the FK) so renames on the parent flow through automatically.
  // The occurrence engine reads these templates at category-pick time
  // to materialise one subtask per occurrence.
  const subTemplatesByMain = useMemo(() => {
    const idToName = new Map(catMasters.map((c) => [c.id, c.name]));
    const map: Record<string, SubTemplate[]> = {};
    for (const c of catMasters) {
      if (!c.parent) continue;
      const parentName = idToName.get(c.parent);
      if (!parentName) continue;
      if (!map[parentName]) map[parentName] = [];
      map[parentName].push({
        name: c.name,
        recurrence: (c.recurrence ?? "") as MasterRecurrence,
        targetDay: c.target_day ?? null,
      });
    }
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name)),
    );
    return map;
  }, [catMasters]);
  // Names-only view used for the SubtaskTable category dropdown filter.
  const subCategoriesByMain = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [main, templates] of Object.entries(subTemplatesByMain)) {
      out[main] = templates.map((t) => t.name);
    }
    return out;
  }, [subTemplatesByMain]);
  const members = useMemo(() => {
    const matchOrg = form.organization;
    const names = profiles
      .filter((p) => (matchOrg ? p.orgs.some((o) => o.uid === matchOrg) : true))
      .map((p) => p.full_name)
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [profiles, form.organization]);
  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => c.name);
    if (!form.organization) return all;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => c.name);
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

  const availableMonths = useMemo(() => {
    const formAny = form as Partial<Task>;
    const start = (task as Partial<Task>)?.engagement_start
      || formAny.engagement_start
      || startMonth + "-01";
    const end = (task as Partial<Task>)?.engagement_end
      || formAny.engagement_end
      || addMonthsToYearMonth(startMonth, engagementMonths - 1) + "-01";
    const startMonthStr = String(start).slice(0, 7);
    const endMonthStr = String(end).slice(0, 7);
    const months = monthsBetween(startMonthStr, endMonthStr);
    const today = thisMonthString();
    if (!months.includes(today)) months.push(today);
    return [...new Set(months)].sort();
  }, [task, form, startMonth, engagementMonths]);

  useEffect(() => {
    const next = task
      ? { ...EMPTY, ...(task as object) }
      : { ...EMPTY, status: defaultStatus ?? "Pending" };
    // Defer the state set past the current render flush so React batches
    // it with the parent's update that triggered this effect.
    Promise.resolve().then(() => {
      setForm(next);
      setSubs([...initialSubs]);
    });
  }, [task, defaultStatus, initialSubs]);

  const flashedFor = useRef<string | null>(null);

  // Auto-scroll a sub row into view when opened from a sub click
  useEffect(() => {
    if (!focusSubId) return;
    if (flashedFor.current === focusSubId) return;
    const el = document.querySelector(`[data-sub-uid="${focusSubId}"]`);
    if (!el) return;
    flashedFor.current = focusSubId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("sub-flash");
    window.setTimeout(() => el.classList.remove("sub-flash"), 1500);
  }, [focusSubId, subs.length]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleOrgChange = (newOrgUid: string) => {
    set("organization", newOrgUid);
    if (newOrgUid && form.client) {
      const obj = clientObjects.find((c) => c.name === form.client);
      if (obj?.orgs.length && !obj.orgs.includes(newOrgUid)) set("client", "");
    }
  };

  const handleClientChange = (clientName: string) => {
    set("client", clientName);
    if (clientName && !form.organization) {
      const obj = clientObjects.find((c) => c.name === clientName);
      const firstOrgUid = obj?.orgs?.[0];
      if (firstOrgUid) set("organization", firstOrgUid);
    }
  };

  const isCreate = !task;
  const subsHaveErrors = hasSubErrors(subs, form.targetDate);

  // Per-org role for the goal being edited. Falls back to "any-org" admin/
  // manager so a brand-new goal (no org chosen yet) doesn't lock the user
  // out of editing the rows they just added. Declared before the template
  // helpers below so the React Compiler can preserve its memoization —
  // the helpers close over ``canManageAll`` to seed the responsible
  // column.
  const canManageAll = useMemo(() => {
    if (form.organization) {
      return isAdminIn(form.organization) || isManagerIn(form.organization);
    }
    return myOrgs.some((o) => o.role === "admin" || o.role === "manager");
  }, [form.organization, isAdminIn, isManagerIn, myOrgs]);

  // Materialise subtask rows for one main category. For each child sub-
  // category we ask the occurrence engine for the list of target dates
  // inside ``[startMonth, startMonth + engagementMonths)`` and emit one
  // row per date. When the sub has no recurrence configured (legacy /
  // empty template) the engine returns a single row with a blank target
  // — same shape as before, no surprise behaviour change.
  //
  // Description gets a "— MMM YYYY" suffix when there are multiple
  // occurrences so the rows are distinguishable in the grid; one-off
  // rows keep just the sub-category name.
  const buildSubsFromTemplate = (
    mainName: string,
    startMonthArg: string,
    engagementMonthsArg: number,
  ): SubtaskItem[] => {
    const templates = subTemplatesByMain[mainName] ?? [];
    if (templates.length === 0) return [];
    const out: SubtaskItem[] = [];
    for (const t of templates) {
      const dates = generateOccurrences({
        recurrence: t.recurrence,
        targetDay: t.targetDay,
        startMonth: startMonthArg,
        engagementMonths: engagementMonthsArg,
      });
      // Empty array can only happen when ``startMonth`` is malformed —
      // emit a single blank-target row so the user can still edit.
      const safeDates = dates.length === 0 ? [""] : dates;
      const multi = safeDates.length > 1;
      for (const d of safeDates) {
        const desc =
          multi && d ? `${t.name} — ${monthLabel(d)}` : t.name;
        out.push({
          id: null,
          description: desc,
          category: t.name,
          responsible: canManageAll ? "" : viewerName,
          targetDate: d,
          expectedDate: "",
          completedDate: "",
          remarks: "",
        });
      }
    }
    return out;
  };

  // Push the goal-level ``targetDate`` out to the latest subtask target
  // so the existing "sub date can't exceed main" validation doesn't trip
  // when the engine generates rows that span the engagement window. Only
  // expands the date — if the user already entered a later target it
  // stays.
  const stretchMainTarget = (newRows: readonly SubtaskItem[]): void => {
    const latest = newRows
      .map((r) => r.targetDate)
      .filter(Boolean)
      .sort()
      .pop();
    if (!latest) return;
    setForm((f) => ({
      ...f,
      targetDate: f.targetDate && f.targetDate > latest ? f.targetDate : latest,
    }));
  };

  const handleCategoryChange = (next: string) => {
    set("category", next);
    if (!next) return;
    const templates = subTemplatesByMain[next] ?? [];
    if (templates.length === 0) return;
    // "Empty" rows are blank placeholders the user hasn't touched yet —
    // safe to overwrite. Real rows have a description, are saved (have an
    // id), or were edited (responsible / dates set). When all current
    // subs are empty we silently load the template; otherwise we ask
    // before appending so the user doesn't lose their work.
    const isEmpty = (s: SubtaskItem) =>
      !s.id &&
      !s.description.trim() &&
      !s.category &&
      !s.responsible &&
      !s.targetDate &&
      !s.expectedDate &&
      !s.completedDate &&
      !s.remarks?.trim();
    const realSubs = subs.filter((s) => !isEmpty(s));
    const newRows = buildSubsFromTemplate(next, startMonth, engagementMonths);
    if (realSubs.length === 0) {
      setSubs(newRows);
      stretchMainTarget(newRows);
      return;
    }
    const ok = window.confirm(
      `Load ${newRows.length} subtask occurrence(s) from "${next}"?\n\nExisting subtasks will be kept and the template appended below them.`,
    );
    if (!ok) return;
    setSubs([...realSubs, ...newRows]);
    stretchMainTarget(newRows);
  };

  // Re-materialise the grid when the user tweaks Start Month or
  // Engagement Months after picking a main category. Confirms before
  // overwriting any row that already has user-entered content.
  const regenerateFromTemplate = (
    nextStart: string,
    nextLength: number,
  ): void => {
    if (!form.category) return;
    const templates = subTemplatesByMain[form.category] ?? [];
    if (templates.length === 0) return;
    const isEmpty = (s: SubtaskItem) =>
      !s.id &&
      !s.description.trim() &&
      !s.category &&
      !s.responsible &&
      !s.targetDate &&
      !s.expectedDate &&
      !s.completedDate &&
      !s.remarks?.trim();
    const realSubs = subs.filter((s) => !isEmpty(s));
    const newRows = buildSubsFromTemplate(
      form.category,
      nextStart,
      nextLength,
    );
    if (realSubs.length === 0) {
      setSubs(newRows);
      stretchMainTarget(newRows);
      return;
    }
    const ok = window.confirm(
      `Replace ${realSubs.length} existing subtask(s) with ${newRows.length} fresh occurrence(s) from "${form.category}"?\n\nClick Cancel to keep them and append the new rows instead.`,
    );
    setSubs(ok ? newRows : [...realSubs, ...newRows]);
    stretchMainTarget(newRows);
  };

  const showEngagementPanel =
    !!form.category &&
    (subTemplatesByMain[form.category] ?? []).some(
      (t) => t.recurrence && t.recurrence !== "Onetime",
    );

  const openSubCount = useMemo(
    () => subs.filter((s) => !s.completedDate).length,
    [subs],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      alert("Please enter a task description.");
      return;
    }
    if (isCreate && !form.reportingManager) {
      alert("Please select a Reporting Manager.");
      return;
    }
    if (subsHaveErrors) {
      alert("Please fix the highlighted sub-task date errors before saving.");
      return;
    }
    if (form.completedDate && openSubCount > 0) {
      alert(
        `Cannot complete the main goal — ${openSubCount} sub-task(s) are still open. Complete every sub-task before marking the goal complete.`,
      );
      return;
    }
    onSave({ ...form, id: task?.id } as Partial<Task> & { id?: string }, subs);
  };

  const headerLabel = task ? `Edit Goal #${task.serialNo ?? ""}` : "Add New Task";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{headerLabel}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <MainGoalFields
            form={form}
            orgs={orgs}
            filteredClients={filteredClients}
            categories={mainCategories}
            members={members}
            clientObjects={clientObjects}
            set={(k, v) => {
              // Intercept goal-category changes so we can auto-populate
              // the subtask grid from the chosen main category's
              // children. Every other field flows through unchanged.
              if (k === "category" && typeof v === "string") {
                handleCategoryChange(v);
                return;
              }
              set(k, v);
            }}
            onOrgChange={handleOrgChange}
            onClientChange={handleClientChange}
            isCreate={isCreate}
          />

          {showEngagementPanel && (
            <div
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                display: "flex",
                gap: 14,
                alignItems: "center",
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <strong style={{ color: "#1e293b" }}>📅 Engagement</strong>
              <label
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <span style={{ color: "#475569", fontWeight: 600 }}>
                  Start month
                </span>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => {
                    setStartMonth(e.target.value);
                    regenerateFromTemplate(e.target.value, engagementMonths);
                  }}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
              </label>
              <label
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <span style={{ color: "#475569", fontWeight: 600 }}>
                  Length (months)
                </span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={engagementMonths}
                  onChange={(e) => {
                    const v = Math.max(
                      1,
                      Math.min(60, Number(e.target.value) || 1),
                    );
                    setEngagementMonths(v);
                    regenerateFromTemplate(startMonth, v);
                  }}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 12,
                    width: 70,
                  }}
                />
              </label>
              <span style={{ color: "#64748b", fontSize: 11 }}>
                Subtasks regenerate from each sub-category&apos;s
                recurrence + target day. Edit rows freely below.
              </span>
            </div>
          )}

          <div
            style={{
              margin: "8px 0",
              display: "flex",
              gap: 12,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <label style={{ fontWeight: 600 }}>Month:</label>
            <select
              value={viewMonth}
              onChange={(e) => setViewMonth(e.target.value)}
              style={{
                padding: "4px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
              }}
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {viewMonth < thisMonthString()
                ? "Read-only — past months are history."
                : "Edits cascade forward to following months."}
            </span>
          </div>

          <SubtaskTable
            subs={subs.filter((s) =>
              s.targetDate ? s.targetDate.startsWith(viewMonth) : false
            )}
            categories={
              // Prefer the chosen main category's children; fall back to
              // every category so legacy goals (no parent links) and
              // un-categorised goals still get a useful dropdown. Always
              // appended to the row's current value so a sub keeps its
              // existing label even if it isn't a child of the new main.
              form.category && subCategoriesByMain[form.category]?.length
                ? subCategoriesByMain[form.category]
                : allCategories
            }
            members={members}
            mainTargetDate={form.targetDate}
            viewerName={viewerName}
            canManageAll={canManageAll}
            onChange={setSubs}
            readOnly={viewMonth < thisMonthString()}
          />

          {form.completedDate && openSubCount > 0 && (
            <div
              style={{
                margin: "8px 0",
                padding: "8px 12px",
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                color: "#92400e",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              ⚠ Main goal cannot be marked complete while {openSubCount} sub-task(s) are still open.
            </div>
          )}

          <div className="modal-foot">
            <div className="modal-foot-left">
              {task && (
                <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                  Task #{task.serialNo}
                </span>
              )}
            </div>
            {task && onDelete && (
              <button
                type="button" className="btn"
                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", marginRight: "auto" }}
                onClick={() => {
                  const subCount = subs.length;
                  const msg = subCount > 0
                    ? `Delete this goal and its ${subCount} sub-task(s)? This cannot be undone.`
                    : "Delete this task? This cannot be undone.";
                  if (window.confirm(msg)) {
                    onDelete(task.id!);
                    onClose();
                  }
                }}
              >
                🗑 Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={subsHaveErrors || (!!form.completedDate && openSubCount > 0)}
            >
              {task ? "✓ Save Goal" : "+ Add Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
